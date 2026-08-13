import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Refuse to build a production artifact from a side branch.
//
// Workers Builds runs this same build for every branch it is told to watch,
// and this project's *non-production branch deploy command* performs a full
// deploy rather than the default `wrangler versions upload`. So every push to
// a claude/* branch republished that branch's code straight over production —
// which is how flowday.day ended up five releases behind main, serving 1.7.2
// while main was on 1.7.7, despite deploys running daily and succeeding.
//
// The real fix is Branch control in the Cloudflare dashboard (production
// branch = main, and non-production deploys back to `versions upload`). This
// is the backstop that survives someone changing that setting again: a red
// build on a side branch costs a retry, a silent production rollback costs
// every user the last five releases. Set ALLOW_BRANCH_DEPLOY=1 to override.
//
// It deliberately **fails open**. Blocking is only correct when the branch is
// known and is definitely not production; anything unrecognised builds as
// normal. A guard that wrongly blocks main takes the whole site down to a
// stale build, which is the exact failure it exists to prevent — whereas
// failing open just restores the old behaviour, and the dashboard setting is
// the real fix anyway. Hence the refs/heads/ stripping and the empty check:
// the runner's exact value for WORKERS_CI_BRANCH is not something this repo
// gets to assume.
const onWorkersCi = process.env.WORKERS_CI === '1';
const ciBranch = (process.env.WORKERS_CI_BRANCH ?? '').trim().replace(/^refs\/heads\//, '');

// Printed on every CI build so the Builds log shows what the runner actually
// passes. If this guard ever misbehaves, that line is the diagnostic.
if (onWorkersCi) {
  console.log(
    `ℹ️ Prebuild: Workers CI branch = ${ciBranch ? `"${ciBranch}"` : "(not set)"} ` +
      `(raw: ${JSON.stringify(process.env.WORKERS_CI_BRANCH ?? null)})`,
  );
}

const isProductionBranch = ciBranch === '' || ciBranch === 'main';
if (onWorkersCi && !isProductionBranch && process.env.ALLOW_BRANCH_DEPLOY !== '1') {
  console.error(
    [
      '',
      `❌ Prebuild: refusing to build branch "${ciBranch}" on Workers CI.`,
      '',
      '   This build would deploy over production. Only "main" ships to',
      '   flowday.day. Fix Branch control in the Cloudflare dashboard',
      '   (Settings > Build > Branch control), or set ALLOW_BRANCH_DEPLOY=1',
      '   if you really do mean to publish this branch.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const distServerDir = resolve(process.cwd(), 'dist/server');
mkdirSync(distServerDir, { recursive: true });

// Suppress Node warning during prerender by making the folder a module
writeFileSync(resolve(distServerDir, 'package.json'), JSON.stringify({ type: 'module' }));

// Minimal placeholder exports to satisfy TanStack Start's initial module scan
const content = `
export const t = {};
export const createServerEntry = () => {};
export const defaultStreamHandler = {};
export const createStartHandler = () => {};
export default {
  fetch: () => new Response('Placeholder', { status: 503 })
};
`;

writeFileSync(resolve(distServerDir, 'server.js'), content.trim());
console.log('✅ Prebuild: Created dist/server/server.js placeholder');
