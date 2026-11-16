// Build: bundle the app with esbuild into public/, copy the pdf.js worker and the fonts.
// `node scripts/build.mjs --dev` also builds public/dev-ai.js (local UI testing only; never deployed).
import { build } from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const dev = process.argv.includes('--dev');

// Start clean so old chunks and source maps never ship.
fs.rmSync(path.join(pub, 'chunks'), { recursive: true, force: true });
for (const f of fs.readdirSync(pub)) if (f.endsWith('.map')) fs.rmSync(path.join(pub, f));

await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  format: 'esm',
  splitting: true,
  outdir: pub,
  entryNames: 'app',
  chunkNames: 'chunks/[name]-[hash]',
  minify: !dev,
  sourcemap: dev,
  target: ['chrome120', 'safari16', 'firefox120'],
  logLevel: 'warning',
});

if (dev) {
  await build({ entryPoints: [path.join(root, 'src/dev-ai.js')], bundle: true, format: 'esm', outfile: path.join(pub, 'dev-ai.js'), logLevel: 'warning' });
} else {
  fs.rmSync(path.join(pub, 'dev-ai.js'), { force: true });
}

fs.copyFileSync(path.join(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'), path.join(pub, 'pdf.worker.min.mjs'));

const fonts = path.join(pub, 'fonts');
fs.mkdirSync(fonts, { recursive: true });
for (const [pkg, files] of Object.entries({
  'bricolage-grotesque': ['latin-600-normal', 'latin-700-normal', 'latin-800-normal'],
  'public-sans': ['latin-400-normal', 'latin-500-normal', 'latin-600-normal', 'latin-700-normal'],
})) {
  for (const f of files) fs.copyFileSync(path.join(root, `node_modules/@fontsource/${pkg}/files/${pkg}-${f}.woff2`), path.join(fonts, `${pkg}-${f}.woff2`));
}
// Point index.html at this exact build, so a browser never pairs a new page with an old cached script.
const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(pub, f))).digest('hex').slice(0, 10);
const indexPath = path.join(pub, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8')
  .replace(/\/app\.js(\?v=[a-f0-9]+)?"/, `/app.js?v=${hash('app.js')}"`)
  .replace(/\/styles\.css(\?v=[a-f0-9]+)?"/, `/styles.css?v=${hash('styles.css')}"`);
fs.writeFileSync(indexPath, html);
console.log(`Built ${dev ? 'dev' : 'production'} bundle into public/`);
