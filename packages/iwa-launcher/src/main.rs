// Launches a Chromium-family browser with Isolated Web App dev mode enabled
// and installs the flow-md IWA shell.
//
// The whole reason this binary exists is one sharp edge: IWA dev-mode flags
// only take effect when the browser *process* starts. If Chrome is already
// running, `open -a "Google Chrome" --args ...` just hands the URL to the
// existing process and every flag is silently dropped — you get a normal tab
// and no idea why nothing worked. So we always pass a dedicated
// `--user-data-dir`, which forces a genuinely separate browser process (and
// keeps this experimental profile well away from your real one).
//
//   iwa-launcher                                  # install from the dev server
//   iwa-launcher --url http://localhost:5193      # ...at an explicit URL
//   iwa-launcher --bundle dist/flow-md.swbn       # install a signed bundle
//   iwa-launcher --no-install                     # just open the IWA profile

use std::env;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

/// IsolatedWebApps + dev mode gets us `isolated-app:` origins and
/// `chrome://web-app-internals` installs; ControlledFrame is what the shell
/// prototype is actually here to exercise. Unknown feature names are ignored
/// by Chrome, so listing ControlledFrame is safe on older builds.
const FEATURES: &str = "IsolatedWebApps,IsolatedWebAppDevMode,ControlledFrame";
const DEFAULT_URL: &str = "http://localhost:5193";
const WAIT_TIMEOUT: Duration = Duration::from_secs(20);

struct Args {
    url: String,
    bundle: Option<PathBuf>,
    chrome: Option<PathBuf>,
    profile: Option<PathBuf>,
    install: bool,
    wait: bool,
    /// Anything after `--`, handed straight to the browser.
    passthrough: Vec<String>,
}

fn usage() -> ! {
    eprintln!(
        "\
flow-md IWA launcher

USAGE:
    iwa-launcher [OPTIONS]

OPTIONS:
    --url <URL>        Dev server to install as an IWA (default: {DEFAULT_URL})
    --bundle <PATH>    Install a signed web bundle (.swbn) instead of a URL
    --chrome <PATH>    Browser binary to use (default: autodetected)
    --profile <PATH>   Browser profile dir (default: ~/.flow-md/iwa-profile)
    --no-install       Launch the profile without (re)installing the app
    --no-wait          Don't wait for the dev server to accept connections
    -- <ARGS>...       Pass the rest straight through to the browser
    -h, --help         Show this help

EXAMPLE:
    # attach a debugger to inspect the running IWA
    iwa-launcher -- --remote-debugging-port=9222

NOTES:
    Flags only apply to a freshly started browser process, which is why a
    dedicated --user-data-dir is always used. Quitting your everyday Chrome
    is not required.

    If Controlled Frame isn't available, enable these at chrome://flags in
    the launched profile: #enable-isolated-web-apps,
    #enable-isolated-web-app-dev-mode, #enable-controlled-frame
"
    );
    std::process::exit(2)
}

fn parse_args() -> Args {
    let mut args = Args {
        url: DEFAULT_URL.to_string(),
        bundle: None,
        chrome: None,
        profile: None,
        install: true,
        wait: true,
        passthrough: Vec::new(),
    };
    let mut it = env::args().skip(1);
    while let Some(arg) = it.next() {
        if arg == "--" {
            args.passthrough.extend(it);
            break;
        }
        let mut value = |flag: &str| -> String {
            it.next()
                .unwrap_or_else(|| fail(&format!("{flag} requires a value")))
        };
        match arg.as_str() {
            "--url" => args.url = value("--url"),
            "--bundle" => args.bundle = Some(PathBuf::from(value("--bundle"))),
            "--chrome" => args.chrome = Some(PathBuf::from(value("--chrome"))),
            "--profile" => args.profile = Some(PathBuf::from(value("--profile"))),
            "--no-install" => args.install = false,
            "--no-wait" => args.wait = false,
            "-h" | "--help" => usage(),
            other => fail(&format!("unknown argument: {other}")),
        }
    }
    args
}

fn fail(msg: &str) -> ! {
    eprintln!("error: {msg}");
    std::process::exit(1)
}

/// Browsers we know how to drive, best first. Helium is the ungoogled build
/// the Xenon folks use; any Chromium ≥ 120 should work.
fn chrome_candidates() -> Vec<PathBuf> {
    let mac = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Helium.app/Contents/MacOS/Helium",
    ];
    let unix = [
        "google-chrome",
        "google-chrome-unstable",
        "google-chrome-beta",
        "chromium",
        "chromium-browser",
        "helium",
    ];
    let windows = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ];

    let mut out: Vec<PathBuf> = Vec::new();
    if cfg!(target_os = "macos") {
        out.extend(mac.iter().map(PathBuf::from));
    }
    if cfg!(target_os = "windows") {
        out.extend(windows.iter().map(PathBuf::from));
    }
    if cfg!(unix) {
        // Resolve bare names against PATH.
        if let Ok(path) = env::var("PATH") {
            for name in unix {
                for dir in path.split(':') {
                    let candidate = Path::new(dir).join(name);
                    if candidate.is_file() {
                        out.push(candidate);
                    }
                }
            }
        }
    }
    out
}

fn find_chrome(override_path: Option<PathBuf>) -> PathBuf {
    if let Some(p) = override_path {
        if !p.is_file() {
            fail(&format!("--chrome path does not exist: {}", p.display()));
        }
        return p;
    }
    if let Ok(p) = env::var("CHROME") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return p;
        }
    }
    chrome_candidates()
        .into_iter()
        .find(|p| p.is_file())
        .unwrap_or_else(|| {
            fail("no Chrome/Chromium found — pass --chrome <path> or set $CHROME")
        })
}

fn default_profile() -> PathBuf {
    let home = env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".flow-md").join("iwa-profile")
}

/// `host:port` of an http(s) URL, for the readiness probe.
fn authority(url: &str) -> Option<String> {
    let rest = url.split("://").nth(1)?;
    let host_port = rest.split('/').next()?;
    if host_port.contains(':') {
        Some(host_port.to_string())
    } else if url.starts_with("https") {
        Some(format!("{host_port}:443"))
    } else {
        Some(format!("{host_port}:80"))
    }
}

/// Chrome races the dev server otherwise: it tries to fetch the manifest
/// before Vite is listening and the install just fails.
fn wait_for(url: &str) {
    let Some(auth) = authority(url) else { return };
    let Ok(addrs) = auth.to_socket_addrs() else {
        eprintln!("warning: could not resolve {auth}, launching anyway");
        return;
    };
    let addrs: Vec<_> = addrs.collect();
    let started = Instant::now();
    print!("waiting for {auth} ");
    loop {
        for addr in &addrs {
            if TcpStream::connect_timeout(addr, Duration::from_millis(300)).is_ok() {
                println!("— up");
                return;
            }
        }
        if started.elapsed() > WAIT_TIMEOUT {
            println!();
            fail(&format!(
                "{auth} never came up — start the shell first (pnpm --filter @flow-md/iwa-shell dev)"
            ));
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

fn main() {
    let args = parse_args();
    let chrome = find_chrome(args.chrome.clone());
    let profile = args.profile.clone().unwrap_or_else(default_profile);

    if let Err(e) = std::fs::create_dir_all(&profile) {
        fail(&format!("could not create profile dir: {e}"));
    }

    let mut cmd = Command::new(&chrome);
    cmd.arg(format!("--user-data-dir={}", profile.display()))
        .arg(format!("--enable-features={FEATURES}"))
        .arg("--no-first-run")
        .arg("--no-default-browser-check");

    if args.install {
        match &args.bundle {
            Some(bundle) => {
                // Chrome needs an absolute path here.
                let abs = bundle
                    .canonicalize()
                    .unwrap_or_else(|e| fail(&format!("--bundle {}: {e}", bundle.display())));
                cmd.arg(format!("--install-isolated-web-app-from-file={}", abs.display()));
            }
            None => {
                if args.wait {
                    wait_for(&args.url);
                }
                cmd.arg(format!("--install-isolated-web-app-from-url={}", args.url));
            }
        }
    }

    println!("browser : {}", chrome.display());
    println!("profile : {}", profile.display());
    match (&args.bundle, args.install) {
        (_, false) => println!("install : skipped (--no-install)"),
        (Some(b), _) => println!("install : bundle {}", b.display()),
        (None, _) => println!("install : url {}", args.url),
    }
    println!("features: {FEATURES}");
    if !args.passthrough.is_empty() {
        cmd.args(&args.passthrough);
        println!("extra   : {}", args.passthrough.join(" "));
    }
    println!();

    match cmd.status() {
        Ok(status) if status.success() => {}
        Ok(status) => eprintln!("browser exited with {status}"),
        Err(e) => fail(&format!("could not launch {}: {e}", chrome.display())),
    }
}
