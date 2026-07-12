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
        // The Nitro Cloudflare adapter mutates `req.ip` on the incoming
        // Request, but srvx's NodeRequest (used by the Vite preview server
        // during SPA prerender) defines `.ip` as a getter — the assignment
        // throws in Node. Wrap the request in a Proxy that lets the CF
        // adapter attach its own properties.
        writeFileSync(
          resolve(outDir, "server.js"),
          `import handler from "./index.mjs";
const extras = new WeakMap();
function wrapRequest(req) {
  extras.set(req, Object.create(null));
  return new Proxy(req, {
    get(target, prop, recv) {
      const own = extras.get(target);
      if (own && prop in own) return own[prop];
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
    set(target, prop, value) {
      const own = extras.get(target);
      if (own) own[prop] = value;
      return true;
    },
    has(target, prop) {
      const own = extras.get(target);
      return (own && prop in own) || prop in target;
    },
  });
}
export default {
  fetch(request, env, context) {
    return handler.fetch(wrapRequest(request), env ?? {}, context ?? { waitUntil() {}, passThroughOnException() {} });
  },
};

`,
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
  // Skip the nitro deploy plugin to prevent it from retargeting output to .output/
  // and breaking TanStack Start's prerender (which expects dist/server/server.js).
  nitro: false,
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
