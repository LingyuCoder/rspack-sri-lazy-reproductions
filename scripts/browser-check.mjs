import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = JSON.parse(fs.readFileSync(path.join(root, 'build-results.json'), 'utf8'));
const variants = new Map(build.results.map(result => [result.name, result]));
const require = createRequire(path.join(process.env.RSPACK_SOURCE, 'tests/e2e/package.json'));
const { chromium } = require('playwright');
const integrity = source => `sha256-${crypto.createHash('sha256').update(source).digest('base64')}`;
const server = http.createServer((request, response) => {
  const [, behavior, name, filename] = new URL(request.url, 'http://localhost').pathname.split('/');
  const variant = variants.get(name);
  if (!variant || !['normal', 'tampered'].includes(behavior)) { response.writeHead(404).end(); return; }
  response.setHeader('Cache-Control', 'no-store');
  const directory = path.join(root, 'dist', name);
  if (filename === 'index.html') {
    const files = variant.scenario === 'depend-on' ? ['runtime.js', 'shared.js', 'main.js'] : ['main.js'];
    const scripts = files.map(file => `<script src="./${file}" integrity="${integrity(fs.readFileSync(path.join(directory, file)))}" crossorigin="anonymous"></script>`).join('\n');
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><meta charset="utf-8"><title>SRI CR reproduction</title>${scripts}`);
    return;
  }
  if (!filename || path.basename(filename) !== filename || !fs.existsSync(path.join(directory, filename))) {
    response.writeHead(404).end(); return;
  }
  response.setHeader('Content-Type', filename.endsWith('.css') ? 'text/css' : 'application/javascript');
  const source = fs.readFileSync(path.join(directory, filename));
  response.end(behavior === 'tampered' && filename === 'b.js'
    ? Buffer.concat([source, Buffer.from('\nglobalThis.tampered = true;\n')]) : source);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const results = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE });
  for (const [name, variant] of variants) {
    for (const behavior of variant.scenario === 'depend-on' ? ['normal'] : ['normal', 'tampered']) {
      const page = await browser.newPage();
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
      });
      const pageErrors = [];
      const consoleErrors = [];
      page.on('pageerror', error => pageErrors.push(String(error)));
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      await page.addInitScript(() => {
        globalThis.requests = [];
        const append = Node.prototype.appendChild;
        Node.prototype.appendChild = function(node) {
          if (this === document.head && (node.tagName === 'SCRIPT' || node.tagName === 'LINK')) {
            globalThis.requests.push({ tag: node.tagName, url: node.src || node.href, integrity: node.integrity });
          }
          return append.call(this, node);
        };
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/${behavior}/${name}/index.html`);
      const execution = await page.evaluate(async scenario => {
        try {
          const value = scenario === 'depend-on' ? globalThis.startup : await globalThis.run();
          return { loaded: value !== undefined, value: value ?? null, tamperedExecuted: globalThis.tampered === true, requests: globalThis.requests };
        } catch (error) {
          return { loaded: false, error: String(error), tamperedExecuted: globalThis.tampered === true, requests: globalThis.requests };
        }
      }, variant.scenario);
      results.push({ name, behavior, ...execution, pageErrors, consoleErrors });
      console.log(`${name} ${behavior}: loaded=${execution.loaded}, value=${execution.value}, tamperedExecuted=${execution.tamperedExecuted}, pageErrors=${JSON.stringify(pageErrors)}`);
      await page.close();
    }
  }
  fs.writeFileSync(path.join(root, 'browser-results.json'), JSON.stringify({ chromium: browser.version(), sourceCommit: build.sourceCommit, results }, null, 2) + '\n');
  const dependOn = results.find(result => result.name === 'depend-on-lazy');
  assert.equal(dependOn.loaded, false);
  assert(dependOn.pageErrors.some(error => error.includes('undefined') || error.includes('null')));
  const css = results.find(result => result.name === 'css-carrier-lazy' && result.behavior === 'tampered');
  assert.equal(css.loaded, true);
  assert.equal(css.tamperedExecuted, true);
  assert.equal(css.requests.find(request => request.url.endsWith('/b.js')).integrity, 'undefined');
  for (const result of results.filter(result => !['depend-on-lazy', 'css-carrier-lazy'].includes(result.name))) {
    assert.equal(result.loaded, result.behavior === 'normal');
    assert.equal(result.tamperedExecuted, false);
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
