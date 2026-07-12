import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
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
