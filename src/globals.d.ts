// Build-time constants injected by vite.config.ts `define`.
// __BUILD_TIME__ stamps each bundle (shown in Settings) so a stale
// dist/client copied into the Android app is immediately recognizable.
declare const __BUILD_TIME__: string;
