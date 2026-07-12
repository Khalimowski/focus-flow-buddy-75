// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//   componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//   error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * A highly resilient plugin to satisfy TanStack Start's SPA prerenderer.
 * It ensures `dist/server/server.js` always exists and correctly aliases
 * to the actual server entry point (whether in dist/ or .output/).
 */
function resilientServerEntry() {
  const root = __dirname;
  const distDir = resolve(root, "dist");
  const distServerDir = resolve(distDir, "server");
  const distClientDir = resolve(distDir, "client");
  const outputServerDir = resolve(root, ".output/server");

  const writeAlias = () => {
    mkdirSync(distServerDir, { recursive: true });

    // Determine where Nitro/Vite actually put the server bundle
    let entryPath = "./index.mjs";
    if (existsSync(join(outputServerDir, "index.mjs"))) {
      // Relative path from dist/server/server.js to .output/server/index.mjs
      entryPath = "../../.output/server/index.mjs";
    } else if (existsSync(join(distServerDir, "index.mjs"))) {
      entryPath = "./index.mjs";
    } else {
      try {
        const assetsDir = join(distServerDir, "assets");
        const files = readdirSync(assetsDir);
        const serverFile = files.find(f => f.startsWith('server-') && f.endsWith('.js'));
        if (serverFile) entryPath = `./assets/${serverFile}`;
      } catch (e) {}
    }

    const content = `
import * as handler from "${entryPath}";
export * from "${entryPath}";

// Polyfill for Request.ip which Cloudflare adapter might try to mutate
const extras = new WeakMap();
function wrapRequest(req) {
  if (!req) return req;
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

// Re-export common names to satisfy the SPA prerenderer's module scan
export const t = handler.t || {};
export const createServerEntry = handler.createServerEntry || (() => {});
export const defaultStreamHandler = handler.defaultStreamHandler || {};
export const createStartHandler = handler.createStartHandler || (() => {});

export default {
  fetch(request, env, context) {
    const target = handler.default || handler;
    if (typeof target.fetch !== 'function') {
       return new Response('Server entry not ready', { status: 503 });
    }
    return target.fetch(wrapRequest(request), env ?? {}, context ?? { waitUntil() {}, passThroughOnException() {} });
  },
};
`;
    writeFileSync(resolve(distServerDir, "server.js"), content.trim());

    // Also ensure dist/server/package.json exists for ES module support
    writeFileSync(resolve(distServerDir, "package.json"), JSON.stringify({ type: "module" }));
  };

  const finalizePublicDir = () => {
    // Ensure index.html exists for Capacitor/SPA fallback
    const shell = resolve(distClientDir, "_shell.html");
    const index = resolve(distClientDir, "index.html");
    if (existsSync(shell) && !existsSync(index)) {
      copyFileSync(shell, index);
    }
  };

  return {
    name: "focus-flow:resilient-server-entry",
    apply: "build" as const,

    // 1. Create placeholder BEFORE any other plugin (like TanStack's) runs
    buildStart() {
      mkdirSync(distServerDir, { recursive: true });
      writeFileSync(resolve(distServerDir, "server.js"), "export default { fetch: () => {} };");
    },

    // 2. Update alias at various points during the build
    renderStart: writeAlias,
    writeBundle: writeAlias,

    // 3. Final organization
    closeBundle: {
      order: "post" as const,
      handler() {
        writeAlias();
        finalizePublicDir();
      }
    }
  };
}

export default defineConfig({
  tanstackStart: {
    // Capacitor apps are SPA-only. Skipping SSR simplifies build-time resolution.
    ssr: false,
    spa: {
      enabled: true,
      prerender: { enabled: false } // We handle static generation via our scripts if needed
    },
  },
  // Ensure Nitro behaves as consistently as possible
  nitro: {
    output: {
      dir: resolve(__dirname, "dist"),
      serverDir: resolve(__dirname, "dist/server"),
      publicDir: resolve(__dirname, "dist/client"),
    },
  },
  vite: {
    plugins: [resilientServerEntry()],
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
