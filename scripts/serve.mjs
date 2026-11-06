import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const requestedRoot = process.argv[2] ?? 'release';
const root = resolve(process.cwd(), requestedRoot);
const port = Number(process.env.PORT ?? 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const candidate = resolve(root, pathname === '/' ? 'index.html' : `.${pathname}`);
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) throw new Error('invalid path');
    const info = await stat(candidate);
    if (!info.isFile()) throw new Error('not a file');
    response.writeHead(200, {
      'Content-Type': types[extname(candidate)] ?? 'application/octet-stream',
      'Cache-Control': extname(candidate) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    createReadStream(candidate).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${port} で ${requestedRoot}/ を配信しています。`);
});
