import assert from 'node:assert/strict';
import { preview } from './preview.mjs';

const root = 'dist/client';
const pages = [...new Bun.Glob('**/page.tsx').scanSync('app')].map((file) => {
  const path = file.replaceAll('\\', '/').replace(/(^|\/)page\.tsx$/, '');
  return path ? '/' + path : '/';
});
const manifest = await Bun.file('dist/server/vinext-prerender.json').json();
const clientManifest = await Bun.file(root + '/.vite/manifest.json').json();
const cssOnly = Object.values(clientManifest)
  .filter((entry) => entry.file.endsWith('.css'))
  .map((entry) => entry.file.split('/').at(-1).split('.')[0]);
for (const path of pages) {
  assert.ok(
    manifest.routes.some(
      (route) => route.route === path && route.status === 'rendered',
    ),
    `Page not exported: ${path}`,
  );
}
const server = await preview({ port: 0 });
try {
  for (const path of pages) {
    const response = await fetch(new URL(path, server.url));
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, /<title>softie/, path);
    assert.match(html, /<meta[^>]+name="description"/, path);
    assert.match(html, /<body[^>]*>[\s\S]+<\/body>/, path);
    for (const match of html.matchAll(
      /<(?:script|link|a|img)\b[^>]*(?:src|href)="(\/[^"?#]+)(?:[?#][^"]*)?"[^>]*>/g,
    )) {
      const asset = match[1].replaceAll('&amp;', '&');
      const linked = await fetch(new URL(asset, server.url));
      // vinext #3064 emits optional preloads for removed CSS-only JS chunks.
      // Keep required scripts/styles/navigation strict; report these upstream hints.
      if (
        linked.status === 404 &&
        /rel="modulepreload"/.test(match[0]) &&
        cssOnly.some((name) =>
          asset.startsWith('/_next/static/chunks/' + name + '-'),
        )
      ) {
        console.warn(`Upstream vinext preload missing: ${asset}`);
        await linked.body?.cancel();
        continue;
      }
      assert.equal(linked.status, 200, `${path} links to ${asset}`);
      await linked.body?.cancel();
    }
    const rsc = path === '/' ? '/index.rsc' : path + '.rsc';
    const data = await fetch(new URL(rsc, server.url));
    assert.equal(data.status, 200, rsc);
    assert.match(data.headers.get('content-type'), /text\/x-component/);
    assert.deepEqual(
      new Uint8Array(await data.arrayBuffer()),
      new Uint8Array(await Bun.file(root + rsc).arrayBuffer()),
      rsc,
    );
  }
  let assets = 0;
  for (const file of new Bun.Glob('**/*').scanSync({
    cwd: 'public',
    onlyFiles: true,
  })) {
    const path = file.replaceAll('\\', '/');
    const response = await fetch(new URL('/' + path, server.url));
    assert.equal(response.status, 200, path);
    const body = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual(
      body,
      new Uint8Array(await Bun.file('public/' + path).arrayBuffer()),
      path,
    );
    assets++;
  }
  const missing = await fetch(new URL('/missing-page', server.url));
  assert.equal(missing.status, 404);
  await missing.body?.cancel();
  const head = await fetch(server.url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const traversal = await fetch(new URL('/%2e%2e%2fpackage.json', server.url));
  assert.equal(traversal.status, 404);
  await traversal.body?.cancel();
  console.log(
    `Static export verified: ${pages.length} pages, navigation payloads, ${assets} public assets, and 404/HEAD/path confinement.`,
  );
} finally {
  await server.stop(true);
}
