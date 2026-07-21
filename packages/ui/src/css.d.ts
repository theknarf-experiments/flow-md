// Ambient declaration so `tsc` (run standalone) accepts CSS Module imports.
// The consuming app's bundler provides the real class-name map.
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
