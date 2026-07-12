// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//   componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//   error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

// TanStack's preview-server-plugin (used during SPA prerender) imports the
// bundled server entry as `dist/server/<entry>.js`, but the Nitro preset
// emits `dist/server/index.mjs` or hashed files. On Cloudflare, Nitro
// retargets output to .output/. Write a resilient alias so prerender can load it.
function serverEntryAlias() {
  const writeAlias = () => {
    const rootDir = process.cwd();
    const distServerDir = resolve(rootDir, "dist/server");
    const outputServerDir = resolve(rootDir, ".output/server");
    mkdirSync(distServerDir, { recursive: true });

    // Determine the best entry path relative to dist/server/server.js
    let entryPath = "./index.mjs";

    if (existsSync(join(outputServerDir, "index.mjs"))) {
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

    const content = `import * as handler from "${entryPath}";
export * from "${entryPath}";

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

// Re-export common names to satisfy the SPA prerenderer
export const t = handler.t || {};
export const createServerEntry = handler.createServerEntry || (() => {});
export const defaultStreamHandler = handler.defaultStreamHandler || {};
export const createStartHandler = handler.createStartHandler || (() => {});

export default {
  fetch(request, env, context) {
    const target = handler.default || handler;
    if (typeof target.fetch !== 'function') {
       return new Response('Server entry not yet ready', { status: 503 });
    }
    return target.fetch(wrapRequest(request), env ?? {}, context ?? { waitUntil() {}, passThroughOnException() {} });
  },
};
`;
    writeFileSync(resolve(distServerDir, "server.js"), content);
  };

  return {
    name: "focus-flow:server-entry-alias",
    apply: "build" as const,
    // Update it during various stages to ensure it points to the right place
    renderStart: writeAlias,
    writeBundle: writeAlias,
    closeBundle: {
      order: "post" as const,
      handler: writeAlias,
    },
  };
}

export default defineConfig({
  tanstackStart: {
    ssr: false,
    spa: { enabled: true },
  },
  // Try to force Nitro output to dist/ to keep it aligned with Capacitor and TanStack Start
  nitro: {
    output: {
      dir: resolve(process.cwd(), "dist"),
      serverDir: resolve(process.cwd(), "dist/server"),
      publicDir: resolve(process.cwd(), "dist/client"),
    },
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
