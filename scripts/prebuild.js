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
const ciBranch = process.env.WORKERS_CI_BRANCH;
if (
  process.env.WORKERS_CI === '1' &&
  ciBranch &&
  ciBranch !== 'main' &&
  process.env.ALLOW_BRANCH_DEPLOY !== '1'
) {
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
