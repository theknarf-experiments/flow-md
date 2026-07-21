// Launches a Chromium-family browser with Isolated Web App dev mode enabled
// and opens the flow-md IWA shell in its own app window.
//
// Two sharp edges this binary exists to hide:
//
//   1. IWA flags are only read when the browser *process* starts. Handing
//      them to a running Chrome silently drops them, so we always use a
//      dedicated --user-data-dir to force a separate process.
//   2. Installing an IWA does not open it, and Chrome's app id is only
//      knowable afterwards. So the first run installs, waits for Chrome to
//      register it (~10s), grants window-management while the browser is
//      stopped, then reopens via --app-id. Later runs go straight there.
//
//   iwa-launcher                             # install if needed, then open
//   iwa-launcher --reinstall                 # force a fresh install
//   iwa-launcher --bundle dist/app.swbn      # install a signed bundle
//   iwa-launcher -- --remote-debugging-port=9222

use std::env;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, Instant};

/// Enabled per profile rather than via --enable-features, because any
/// unrecognised command-line switch makes Chrome hang a yellow "unsupported
/// command-line flag" infobar off the top of every window — 56px of chrome we
/// just went to some trouble to remove. Written into Local State instead,
/// which is exactly what chrome://flags does.
///
/// Controlled Frame needs no flag: it's gated by the manifest's
/// permissions_policy, not by chrome://flags.
const FLAGS: [&str; 3] = [
    "enable-isolated-web-apps@1",
    "enable-isolated-web-app-dev-mode@1",
    "enable-unframed-iwa@1",
];
const DEFAULT_URL: &str = "http://localhost:5193";
const SERVER_TIMEOUT: Duration = Duration::from_secs(20);
const INSTALL_TIMEOUT: Duration = Duration::from_secs(60);

struct Args {
    url: String,
    bundle: Option<PathBuf>,
    chrome: Option<PathBuf>,
    profile: Option<PathBuf>,
    reinstall: bool,
    wait: bool,
    passthrough: Vec<String>,
}

fn usage() -> ! {
    eprintln!(
        "\
flow-md IWA launcher

USAGE:
    iwa-launcher [OPTIONS] [-- <BROWSER ARGS>...]

OPTIONS:
    --url <URL>        Dev server to install from (default: {DEFAULT_URL})
    --bundle <PATH>    Install a signed web bundle (.swbn) instead of a URL
    --chrome <PATH>    Browser binary to use (default: autodetected)
    --profile <PATH>   Browser profile dir (default: ~/.flow-md/iwa-profile)
    --reinstall        Install again even if the app is already present
    --no-wait          Don't wait for the dev server to accept connections
    -- <ARGS>...       Pass the rest straight through to the browser
    -h, --help         Show this help

EXAMPLE:
    # attach a debugger to the running IWA
    iwa-launcher -- --remote-debugging-port=9222

NOTES:
    First run installs the app, waits for Chrome to register it, then reopens
    it as an app window. Later runs go straight to the app window.

    Flags and the window-management permission are set in the profile for
    you — no chrome://flags visit and no permission prompt to click.
"
    );
    std::process::exit(2)
}

fn fail(msg: &str) -> ! {
    eprintln!("error: {msg}");
    std::process::exit(1)
}

fn parse_args() -> Args {
    let mut args = Args {
        url: DEFAULT_URL.to_string(),
        bundle: None,
        chrome: None,
        profile: None,
        reinstall: false,
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
            "--reinstall" => args.reinstall = true,
            "--no-wait" => args.wait = false,
            "-h" | "--help" => usage(),
            other => fail(&format!("unknown argument: {other}")),
        }
    }
    args
}

/// Browsers we know how to drive, best first. Helium is the ungoogled build
/// the Xenon folks use; any Chromium >= 120 should work.
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
        .unwrap_or_else(|| fail("no Chrome/Chromium found — pass --chrome <path> or set $CHROME"))
}

fn default_profile() -> PathBuf {
    let home = env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".flow-md").join("iwa-profile")
}

// ------------------------------------------------------- installed app ids

/// Every `isolated-app://<id>` origin mentioned in the profile's Preferences.
/// Hand-rolled rather than pulling in a regex crate for one scan.
fn installed_ids(profile: &Path) -> Vec<String> {
    const PREFIX: &str = "isolated-app://";
    let prefs = profile.join("Default").join("Preferences");
    let Ok(text) = std::fs::read_to_string(&prefs) else {
        return Vec::new();
    };
    let mut out: Vec<String> = Vec::new();
    let mut rest = text.as_str();
    while let Some(i) = rest.find(PREFIX) {
        rest = &rest[i + PREFIX.len()..];
        // Web Bundle IDs are base32 (a-z, 2-7) and 56-58 chars long.
        let id: String = rest
            .chars()
            .take_while(|c| c.is_ascii_lowercase() || ('2'..='7').contains(c))
            .collect();
        if id.len() >= 50 && !out.contains(&id) {
            out.push(id);
        }
    }
    out
}

/// Chrome writes Preferences lazily — the id shows up ~10s after install.
fn wait_for_new_id(profile: &Path, before: &[String]) -> Option<String> {
    let started = Instant::now();
    while started.elapsed() < INSTALL_TIMEOUT {
        std::thread::sleep(Duration::from_millis(500));
        let now = installed_ids(profile);
        if let Some(fresh) = now.iter().find(|id| !before.contains(id)) {
            return Some(fresh.clone());
        }
    }
    None
}

// ------------------------------------------------------------- unframed IWA
//
// Dropping Chrome's title bar so the shell can draw its own chrome needs four
// things lined up, and they're order-dependent:
//
//   1. "unframed" in the manifest's display_override        (packages/iwa-shell)
//   2. Chrome's enable-unframed-iwa flag, per profile       (here)
//   3. the window-management permission granted             (the shell asks)
//   4. the app (re)installed *after* 2 — Chrome resolves the display mode at
//      install time, so flipping the flag later changes nothing
//
// We own this profile outright, so we set the flag ourselves rather than
// making anyone click through chrome://flags.

/// Enable our flags in the profile. Returns true if anything changed, which
/// means an already-installed app needs reinstalling (see 4 above).
/// Must run while the browser is stopped, or Chrome will overwrite us.
fn ensure_flags(profile: &Path) -> bool {
    let path = profile.join("Local State");
    let mut root: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    let list = root["browser"]["enabled_labs_experiments"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut names: Vec<String> = list
        .iter()
        .filter_map(|v| v.as_str().map(str::to_owned))
        .collect();

    let mut changed = false;
    for flag in FLAGS {
        if names.iter().any(|n| n == flag) {
            continue;
        }
        // Chrome normalises to "name@index"; a bare name is dropped on start.
        let stem = flag.split('@').next().unwrap_or(flag);
        names.retain(|n| n.split('@').next() != Some(stem));
        names.push(flag.to_string());
        changed = true;
    }
    if !changed {
        return false;
    }

    root["browser"]["enabled_labs_experiments"] = serde_json::json!(names);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::write(&path, root.to_string()) {
        Ok(()) => {
            println!("flags   : enabled {}", FLAGS.join(", "));
            true
        }
        Err(e) => {
            eprintln!("warning: could not enable flags: {e}");
            false
        }
    }
}

/// Chrome timestamps content settings in microseconds since 1601-01-01.
fn chrome_now() -> String {
    let micros = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_micros())
        .unwrap_or(0);
    (micros + 11_644_473_600_000_000).to_string()
}

/// Grant window-management to the app origin by writing the content setting
/// straight into the profile — step 3 of the unframed recipe.
///
/// The alternative is making someone click a permission prompt on every fresh
/// profile, which defeats the point of having a launcher. We own this profile
/// outright, and the grant has to be in place *before* the window is created,
/// so this runs while the browser is stopped between install and launch.
///
/// Chrome has renamed this content setting over time, so write both spellings;
/// the one it doesn't recognise is ignored.
fn grant_window_management(profile: &Path, app_id: &str) -> bool {
    let path = profile.join("Default").join("Preferences");
    let mut root: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    let pattern = format!("isolated-app://{app_id}/,*");
    let entry = serde_json::json!({ "last_modified": chrome_now(), "setting": 1 });
    for setting in ["window_placement", "window_management"] {
        root["profile"]["content_settings"]["exceptions"][setting][&pattern] = entry.clone();
    }

    match std::fs::write(&path, root.to_string()) {
        Ok(()) => {
            println!("grant   : window-management for isolated-app://{}…", &app_id[..12.min(app_id.len())]);
            true
        }
        Err(e) => {
            eprintln!("warning: could not grant window-management: {e}");
            false
        }
    }
}

/// Installing a web app makes Chrome reveal the generated shim in Finder,
/// stealing focus. There's no switch to suppress it, so shoo it away.
///
/// Chrome opens the window somewhat after the install registers, so a single
/// close races it — this keeps sweeping in the background for a few seconds.
#[cfg(target_os = "macos")]
fn dismiss_finder_popup() {
    std::thread::spawn(|| {
        for _ in 0..12 {
            let _ = Command::new("osascript")
                .arg("-e")
                .arg(
                    r#"tell application "Finder"
                         try
                           close (every window whose name contains "Chrome Apps")
                         end try
                       end tell"#,
                )
                .output();
            std::thread::sleep(Duration::from_millis(700));
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn dismiss_finder_popup() {}

// ------------------------------------------------------------ app launching
//
// Opening an installed IWA turned out to be the fiddly part. Neither
// `--app=isolated-app://…` nor passing the URL positionally works — Chrome
// ignores both. The only switch that opens it is `--app-id=<32-char id>`,
// Chrome's internal web-app id, which is *not* the Web Bundle ID.
//
// On macOS that id is recorded in the app shim Chrome generates at install
// time, along with the profile it belongs to — so we read it back out of the
// shim rather than trying to derive it.

#[derive(Debug)]
struct InstalledApp {
    app_id: String,
    name: String,
}

#[cfg(target_os = "macos")]
fn plist_value(plist: &Path, key: &str) -> Option<String> {
    let out = Command::new("plutil")
        .args(["-extract", key, "raw", "-o", "-"])
        .arg(plist)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

/// The newest Chrome app shim that belongs to this profile and points at an
/// isolated-app:// origin.
#[cfg(target_os = "macos")]
fn find_installed_app(profile: &Path) -> Option<InstalledApp> {
    let home = env::var("HOME").ok()?;
    let dirs = [
        PathBuf::from(&home).join("Applications/Chrome Apps.localized"),
        PathBuf::from(&home).join("Applications/Chrome Apps"),
    ];
    let mut best: Option<(std::time::SystemTime, InstalledApp)> = None;
    for dir in dirs.iter().filter(|d| d.is_dir()) {
        let Ok(entries) = std::fs::read_dir(dir) else { continue };
        for entry in entries.flatten() {
            let plist = entry.path().join("Contents/Info.plist");
            if !plist.is_file() {
                continue;
            }
            let url = plist_value(&plist, "CrAppModeShortcutURL").unwrap_or_default();
            if !url.starts_with("isolated-app://") {
                continue;
            }
            // Only shims for *this* profile.
            let data_dir = plist_value(&plist, "CrAppModeUserDataDir").unwrap_or_default();
            if !data_dir.contains(&profile.display().to_string()) {
                continue;
            }
            let Some(app_id) = plist_value(&plist, "CrAppModeShortcutID") else { continue };
            let name = plist_value(&plist, "CrAppModeShortcutName").unwrap_or_default();
            let mtime = entry
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            if best.as_ref().is_none_or(|(t, _)| mtime > *t) {
                best = Some((mtime, InstalledApp { app_id, name }));
            }
        }
    }
    best.map(|(_, app)| app)
}

#[cfg(not(target_os = "macos"))]
fn find_installed_app(_profile: &Path) -> Option<InstalledApp> {
    // Chrome records the web-app id differently per platform; on Linux it's a
    // .desktop entry, on Windows a Start Menu shortcut. Not needed yet.
    None
}

// ----------------------------------------------------------- dev server wait

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

/// Chrome races the dev server otherwise: it fetches the manifest before Vite
/// is listening and the install just fails.
fn wait_for_server(url: &str) {
    let Some(auth) = authority(url) else { return };
    let Ok(addrs) = auth.to_socket_addrs() else {
        eprintln!("warning: could not resolve {auth}, continuing anyway");
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
        if started.elapsed() > SERVER_TIMEOUT {
            println!();
            fail(&format!(
                "{auth} never came up — start it first (pnpm --filter @flow-md/iwa-shell dev)"
            ));
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

// ----------------------------------------------------------------- launching

fn base_command(chrome: &Path, profile: &Path, extra: &[String]) -> Command {
    let mut cmd = Command::new(chrome);
    cmd.arg(format!("--user-data-dir={}", profile.display()))
        .arg("--no-first-run")
        .arg("--no-default-browser-check");
    cmd.args(extra);
    cmd
}

fn spawn(mut cmd: Command, what: &str) -> Child {
    cmd.spawn()
        .unwrap_or_else(|e| fail(&format!("could not launch browser ({what}): {e}")))
}

fn main() {
    let args = parse_args();
    let chrome = find_chrome(args.chrome.clone());
    let profile = args.profile.clone().unwrap_or_else(default_profile);

    if let Err(e) = std::fs::create_dir_all(&profile) {
        fail(&format!("could not create profile dir: {e}"));
    }

    println!("browser : {}", chrome.display());
    println!("profile : {}", profile.display());

    if args.wait && args.bundle.is_none() {
        wait_for_server(&args.url);
    }

    // Must happen before the browser starts, and before any install: Chrome
    // bakes the display mode in at install time.
    let flag_changed = ensure_flags(&profile);
    if flag_changed && find_installed_app(&profile).is_some() {
        println!("(flags just enabled — reinstalling so they take effect)");
    }

    let known = installed_ids(&profile);
    let mut app = if args.reinstall || flag_changed {
        None
    } else {
        find_installed_app(&profile)
    };

    // ---- install phase (first run, or --reinstall) ----
    if app.is_none() {
        let mut cmd = base_command(&chrome, &profile, &args.passthrough);
        match &args.bundle {
            Some(bundle) => {
                let abs = bundle
                    .canonicalize()
                    .unwrap_or_else(|e| fail(&format!("--bundle {}: {e}", bundle.display())));
                println!("install : bundle {}", abs.display());
                cmd.arg(format!("--install-isolated-web-app-from-file={}", abs.display()));
            }
            None => {
                println!("install : url {}", args.url);
                cmd.arg(format!("--install-isolated-web-app-from-url={}", args.url));
            }
        }
        println!("(installing — this window closes once the app is registered)");
        let mut child = spawn(cmd, "install");

        match wait_for_new_id(&profile, &known) {
            Some(id) => {
                println!("installed: isolated-app://{id}");
                // Chrome reveals the shim in Finder on install; dismiss it
                // before it steals focus.
                dismiss_finder_popup();
                let _ = child.kill();
                let _ = child.wait();
                // Give Chrome a moment to release the profile lock, and the
                // shim a moment to land on disk.
                std::thread::sleep(Duration::from_millis(2000));
                // Browser stopped: the only safe moment to edit Preferences,
                // and it must happen before the app window is created.
                grant_window_management(&profile, &id);
                app = find_installed_app(&profile);
            }
            None => {
                let _ = child.wait();
                fail("install did not register within 60s — check chrome://web-app-internals");
            }
        }
    }

    // ---- launch phase ----
    let Some(app) = app else {
        let ids = installed_ids(&profile);
        eprintln!("\ninstalled, but could not resolve the app id automatically.");
        if let Some(id) = ids.last() {
            eprintln!("open it from chrome://apps, or visit isolated-app://{id}/");
        }
        std::process::exit(1);
    };
    println!("opening : {} (--app-id={})\n", app.name, app.app_id);

    let mut cmd = base_command(&chrome, &profile, &args.passthrough);
    cmd.arg(format!("--app-id={}", app.app_id));
    match cmd.status() {
        Ok(status) if status.success() => {}
        Ok(status) => eprintln!("browser exited with {status}"),
        Err(e) => fail(&format!("could not launch {}: {e}", chrome.display())),
    }
}
