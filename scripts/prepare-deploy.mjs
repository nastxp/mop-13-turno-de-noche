// Prepara la carpeta deploy/ para subirla al servidor:
//   dist/   → deploy/dist/    (el juego compilado con `npm run build`)
//   slides/ → deploy/slides/  (la presentación del TFM, sin ficheros de trabajo)
// Uso: npm run deploy:prepare
import { cpSync, existsSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const deploy = join(root, 'deploy');

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('No existe dist/index.html: ejecuta antes `npm run build`.');
  process.exit(1);
}

// ficheros de la carpeta slides/ que solo sirven para editarla
const SKIP = new Set(['node_modules', '.hyperframes', '.gitignore', 'package.json', 'package-lock.json']);

for (const [from, to, filter] of [
  ['dist', 'dist', () => true],
  ['slides', 'slides', (src) => !SKIP.has(basename(src))],
]) {
  const dest = join(deploy, to);
  rmSync(dest, { recursive: true, force: true });
  cpSync(join(root, from), dest, { recursive: true, filter });
  console.log(`✓ ${from}/ → deploy/${to}/`);
}

console.log('\nListo. Sube la carpeta deploy/ al servidor y arráncalo con `npm start`.');
