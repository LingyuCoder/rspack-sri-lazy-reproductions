import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const report = JSON.parse(fs.readFileSync(path.join(root, 'results.json'), 'utf8'));
const require = createRequire(path.join(process.env.RSPACK_SOURCE, 'tests/e2e/package.json'));
const { chromium } = require('playwright');
const names = new Set(report.results.map(result => result.name));
const server = http.createServer((request, response) => {
  const [, behavior, name, phase, file] = new URL(request.url, 'http://localhost').pathname.split('/');
  if (!['normal', 'tampered'].includes(behavior) || !names.has(name) || !['initial', 'rebuild'].includes(phase)) {
    response.writeHead(404).end();
    return;
  }
  response.setHeader('Cache-Control', 'no-store');
  if (file === 'index.html') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><meta charset="utf-8"><title>SRI rebuild reproduction</title><script src="./main.js"></script>');
    return;
  }
  if (!['main.js', 'a.js', 'b.js'].includes(file)) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', 'application/javascript');
  const source = fs.readFileSync(path.join(root, 'runs', name, phase, file));
  // Alter B after bundling, without changing its recorded integrity.
  response.end(behavior === 'tampered' && file === 'b.js'
    ? Buffer.concat([source, Buffer.from('\nglobalThis.tampered = true;\n')])
    : source);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE });
  for (const name of names) {
    for (const phase of ['initial', 'rebuild']) {
      for (const behavior of ['normal', 'tampered']) {
        const page = await browser.newPage();
        await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
        const errors = [];
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.addInitScript(() => {
          globalThis.scriptRequests = [];
          const append = Node.prototype.appendChild;
          Node.prototype.appendChild = function(node) {
            if (this === document.head && node.tagName === 'SCRIPT') globalThis.scriptRequests.push({
              src: node.src, integrity: node.integrity, attribute: node.getAttribute('integrity'),
            });
            return append.call(this, node);
          };
        });
        const address = `http://127.0.0.1:${server.address().port}/${behavior}/${name}/${phase}/index.html`;
        await page.goto(address);
        const execution = await page.evaluate(async () => {
          try {
            const value = await globalThis.run();
            return { loaded: true, value, tamperedExecuted: globalThis.tampered === true, requests: globalThis.scriptRequests };
          } catch (error) {
            return { loaded: false, error: String(error), tamperedExecuted: globalThis.tampered === true, requests: globalThis.scriptRequests };
          }
        });
        results.push({ name, phase, behavior, ...execution, errors });
        console.log(`${name} ${phase} ${behavior}: loaded=${execution.loaded}, tamperedExecuted=${execution.tamperedExecuted}`);
        await page.close();
      }
    }
  }
  fs.writeFileSync(path.join(root, 'browser-results.json'), JSON.stringify({ chromium: browser.version(), results }, null, 2) + '\n');
  for (const result of results.filter(result => result.phase === 'initial' && result.behavior === 'tampered')) {
    assert.equal(result.loaded, false, 'Initial SRI must reject tampering');
    assert.equal(result.tamperedExecuted, false);
  }
  for (const result of results.filter(result => result.name === 'lazy-full-runtime-requirements' || result.name === 'eager-partial')) {
    assert.equal(result.loaded, result.behavior === 'normal');
    assert.equal(result.tamperedExecuted, false);
  }
  const failure = results.find(result => result.name === 'lazy-partial' && result.phase === 'rebuild' && result.behavior === 'tampered');
  assert.equal(failure.loaded, true);
  assert.equal(failure.tamperedExecuted, true, 'Rebuilt lazy-partial bundle accepts tampered B');
  assert.equal(failure.requests.find(request => request.src.endsWith('/b.js')).integrity, 'undefined');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
