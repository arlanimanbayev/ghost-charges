// Tiny static server for local development: http://localhost:5173
// MOCK=1 loads the stand-in AI (public/dev-ai.js) before the app, for UI work without Firebase.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const port = Number(process.env.PORT || 5173);
const mock = process.env.MOCK === '1';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.csv': 'text/csv', '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.map': 'application/json' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = path.join(pub, decodeURIComponent(url.pathname));
  if (!file.startsWith(pub)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404).end('Not found'); return; }
  let body = fs.readFileSync(file);
  if (mock && file.endsWith('index.html')) body = Buffer.from(body.toString().replace(/<script type="module" src="\/app\.js/, '<script type="module" src="/dev-ai.js"></script>\n  $&'));
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(body);
}).listen(port, () => console.log(`Ghost Charges on http://localhost:${port}${mock ? ' (stand-in AI)' : ''}`));
