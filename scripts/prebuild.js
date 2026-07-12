import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
