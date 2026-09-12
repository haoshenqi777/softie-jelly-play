import { realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';

// Serve only the exported files, without an application server or SPA fallback.
export async function preview({ port = 4173, root = 'dist/client' } = {}) {
  const directory = await realpath(root);
  if (!(await Bun.file(resolve(directory, 'index.html')).exists())) {
    throw new Error('Static export missing. Run bun run build first.');
  }
  return Bun.serve({
    hostname: '127.0.0.1',
    port,
    async fetch(request) {
      if (!['GET', 'HEAD'].includes(request.method)) {
        return new Response(null, {
          status: 405,
          headers: { Allow: 'GET, HEAD' },
        });
      }
      let path;
      try {
        path = decodeURIComponent(new URL(request.url).pathname);
      } catch {
        return new Response('Bad request', { status: 400 });
      }
      if (path.includes('\\') || path.includes('\0')) {
        return new Response('Bad request', { status: 400 });
      }
      const candidates = path.endsWith('/')
        ? [path + 'index.html']
        : [path, path + '.html', path + '/index.html'];
      for (const candidate of candidates) {
        const target = await realpath(
          resolve(directory, '.' + candidate),
        ).catch(() => null);
        if (!target) continue;
        const local = relative(directory, target);
        if (local === '..' || local.startsWith('..' + sep) || isAbsolute(local))
          continue;
        if (!(await stat(target)).isFile()) continue;
        const file = Bun.file(target);
        if (candidate === path + '/index.html' && !path.endsWith('/')) {
          const url = new URL(request.url);
          url.pathname += '/';
          return Response.redirect(url, 308);
        }
        const headers = {
          'Content-Type': candidate.endsWith('.rsc')
            ? 'text/x-component'
            : file.type,
        };
        return new Response(request.method === 'HEAD' ? null : file, {
          headers,
        });
      }
      const missing = Bun.file(resolve(directory, '404.html'));
      return new Response(
        request.method === 'HEAD'
          ? null
          : (await missing.exists())
            ? missing
            : 'Not found',
        {
          status: 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        },
      );
    },
  });
}

if (import.meta.main) {
  const server = await preview({ port: Number(process.env.PORT ?? 4173) });
  console.log(`Static preview: ${server.url}`);
}
