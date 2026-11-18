import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'dist-electron');
const skipVite = process.argv.includes('--skip-vite');

async function main() {
  if (!skipVite) {
    console.log('[TaktWerk Desktop] Building web frontend (vite build)...');
    execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });
  }

  fs.mkdirSync(outDir, { recursive: true });

  console.log('[TaktWerk Desktop] Bundling embedded backend server (esbuild)...');
  await build({
    entryPoints: [path.join(rootDir, 'server.ts')],
    outfile: path.join(outDir, 'server.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    sourcemap: false,
    external: ['express', 'dotenv', 'dotenv/config', '@google/genai', 'vite'],
    logLevel: 'info',
  });

  const stat = fs.statSync(path.join(outDir, 'server.cjs'));
  console.log(
    `[TaktWerk Desktop] Ready: dist-electron/server.cjs (${(stat.size / 1024).toFixed(1)} KB)`
  );
}

main().catch((err) => {
  console.error('[TaktWerk Desktop] Build failed:', err);
  process.exit(1);
});
