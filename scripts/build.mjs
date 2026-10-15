import { readFile, writeFile, readdir, mkdir, rm, copyFile } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';
const root = new URL('../', import.meta.url).pathname;
const source = join(root, 'web');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };
const assets = {};
async function add(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await add(path);
    else assets['/' + relative(source, path)] = { body: await readFile(path, 'utf8'), type: types[extname(path)] || 'application/octet-stream' };
  }
}
await add(source);
const worker = (await readFile(join(root, 'worker/index.js'), 'utf8')).replace('/* INLINE_ASSETS */ {}', () => JSON.stringify(assets));
await rm(join(root, 'dist'), { recursive: true, force: true });
await mkdir(join(root, 'dist/server'), { recursive: true });
await mkdir(join(root, 'dist/.openai'), { recursive: true });
await writeFile(join(root, 'dist/server/index.js'), worker);
await copyFile(join(root, '.openai/hosting.json'), join(root, 'dist/.openai/hosting.json'));
console.log(`Built ${Object.keys(assets).length} assets into the Site Worker.`);
