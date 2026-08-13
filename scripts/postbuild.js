import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

// The worker the live domains actually point at: flowday.day and
// focus-flow-buddy-75.kacper-szymanski1990.workers.dev.
const WORKER_NAME = 'focus-flow-buddy-75';
const shell = resolve(root, 'dist/client/_shell.html');
const index = resolve(root, 'dist/client/index.html');

if (existsSync(shell)) {
  copyFileSync(shell, index);
  console.log('✅ Postbuild: Copied _shell.html to index.html');
} else {
  console.warn('⚠️ Postbuild: _shell.html not found, skipping index.html copy');
}

// Ensure the Capacitor webDir exists and is not empty
const clientDir = resolve(root, 'dist/client');
if (!existsSync(clientDir)) {
    mkdirSync(clientDir, { recursive: true });
}

// Pin the worker name in the config nitro generates.
//
// Nitro derives a name from the git remote when nothing pins one, which comes
// out as "khalimowski-focus-flow-buddy-75" — a worker that does not exist on
// the account. `wrangler deploy` run from the repo root follows
// .wrangler/deploy/config.json straight to this file, so an unpinned name
// quietly creates a *second* worker and leaves the live domains serving
// whatever they served before. Overwriting it here keeps every deploy path —
// CI, or a manual deploy from dist/ — aimed at the worker the domains use.
const wranglerConfig = resolve(root, 'dist/server/wrangler.json');
if (existsSync(wranglerConfig)) {
  try {
    const config = JSON.parse(readFileSync(wranglerConfig, 'utf8'));
    if (config.name !== WORKER_NAME) {
      console.log(`🔧 Postbuild: worker name "${config.name}" -> "${WORKER_NAME}"`);
      config.name = WORKER_NAME;
      writeFileSync(wranglerConfig, JSON.stringify(config, null, 2));
    } else {
      console.log(`✅ Postbuild: worker name already "${WORKER_NAME}"`);
    }
  } catch (err) {
    // Never fail the build over this — a wrong name is recoverable, a build
    // that will not produce dist/client is not.
    console.warn(`⚠️ Postbuild: could not pin worker name: ${err}`);
  }
}
