const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const manifestFile = path.join(publicDir, 'image-manifest.json');
const extensions = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);
const ignoredDirectories = new Set(['APITest', 'node_modules']);

function walk(directory, entries = []) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    const absolutePath = path.join(directory, item.name);
    if (item.isDirectory()) {
      if (!ignoredDirectories.has(item.name)) walk(absolutePath, entries);
      continue;
    }
    if (!item.isFile() || !extensions.has(path.extname(item.name).toLowerCase())) continue;
    const relative = path.relative(publicDir, absolutePath).split(path.sep).map(encodeURIComponent).join('/');
    entries.push({
      path: `/${relative}`,
      name: item.name,
      directory: path.relative(publicDir, path.dirname(absolutePath)).split(path.sep).join('/'),
    });
  }
  return entries;
}

const images = walk(publicDir).sort((a, b) => a.path.localeCompare(b.path, 'pt-BR'));
fs.writeFileSync(manifestFile, `${JSON.stringify({ images }, null, 2)}\n`, 'utf8');
process.stdout.write(`Catálogo atualizado: ${images.length} imagens públicas.\n`);
