import { readFile, writeFile, mkdir } from 'node:fs/promises';

const files = [
  ['node_modules/chess.js/dist/esm/chess.js', 'vendor/chess.js'],
  ['node_modules/chess.js/LICENSE', 'vendor/chess.LICENSE'],
];
await mkdir('vendor', { recursive: true });
for (const [source, target] of files) {
  const content = await readFile(source, 'utf8');
  if (process.argv.includes('--check')) {
    if ((await readFile(target, 'utf8')) !== content)
      throw new Error(`Run npm run vendor: ${target}`);
  } else {
    await writeFile(target, content);
  }
}
console.log('Vendored chess.js and license are up to date.');
