// Ambient declaration so `tsc` (run standalone for this package) accepts CSS
// Module imports. The app's bundler (Vite) provides the real class-name map.
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
