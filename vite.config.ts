// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//   componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//   error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// TanStack's preview-server-plugin (used during SPA prerender) imports the
// bundled server entry as `dist/server/<entry>.js`, but the Nitro preset
// emits `dist/server/index.mjs`. Write a tiny alias so prerender can load it.
function serverEntryAlias() {
  return {
    name: "focus-flow:server-entry-alias",
    apply: "build" as const,
    closeBundle: {
      order: "post" as const,
      handler() {
        const outDir = resolve(process.cwd(), "dist/server");
        const target = resolve(outDir, "index.mjs");
        if (!existsSync(target)) return;
        mkdirSync(outDir, { recursive: true });
        writeFileSync(
          resolve(outDir, "server.js"),
          `export { default } from "./index.mjs";\n`,
        );
      },
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // Enable SPA mode so it generates the static HTML file Capacitor needs
    spa: { enabled: true },
  },
  vite: {
    plugins: [serverEntryAlias()],
    ssr: {
      external: [
        "@capacitor/core",
        "@capacitor/app",
        "@capacitor/status-bar",
        "@capacitor/splash-screen",
        "@capacitor/local-notifications",
        "capacitor-calendar",
      ],
    },
  },
});
