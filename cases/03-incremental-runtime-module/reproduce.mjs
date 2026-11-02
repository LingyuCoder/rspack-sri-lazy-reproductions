import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeConfig } from './rspack.config.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = process.env.RSPACK_SOURCE;
assert(sourceRoot, 'Set RSPACK_SOURCE to a built checkout of PR #16374');
const sourceCommit = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(sourceCommit, 'ba2e2eef60d53a3ede5882c3cde08fc2a94a3fb6');
assert.equal(execFileSync('git', ['-C', sourceRoot, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '', 'Use the clean original PR source');
const rspack = await import(pathToFileURL(path.join(sourceRoot, 'packages/rspack/dist/index.js')));
const hash = source => `sha256-${crypto.createHash('sha256').update(source).digest('base64')}`;

// Execute the emitted web runtime and its actual script loader. This minimal DOM
// records attributes; it does not claim to emulate browser SRI enforcement.
async function loadBundle(directory) {
  const requests = [];
  const sandbox = { console, setTimeout, clearTimeout, URL };
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  sandbox.location = new URL('https://example.test/index.html');
  const context = vm.createContext(sandbox);
  const head = {
    appendChild(script) {
      script.parentNode = head;
      const filename = path.basename(new URL(script.src).pathname);
      const source = fs.readFileSync(path.join(directory, filename));
      requests.push({
        filename,
        integrity: script.integrity ?? null,
        expected: hash(source),
        matches: script.integrity === hash(source),
      });
      queueMicrotask(() => {
        try {
          vm.runInContext(source.toString(), context, { filename });
          script.onload?.({ type: 'load', target: script });
        } catch (error) {
          script.onerror?.({ type: 'error', target: script });
          console.error(error);
        }
      });
      return script;
    },
    removeChild(script) { script.parentNode = null; },
  };
  sandbox.document = {
    head,
    currentScript: { src: 'https://example.test/main.js', tagName: 'SCRIPT' },
    createElement() {
      const attributes = {};
      return {
        setAttribute(name, value) { attributes[name] = String(value); },
        getAttribute(name) { return attributes[name] ?? null; },
      };
    },
    getElementsByTagName() { return []; },
  };
  vm.runInContext(fs.readFileSync(path.join(directory, 'main.js'), 'utf8'), context);
  const value = await context.run();
  return { value, buildMarker: context.buildMarker, requests, allVerified: requests.every(request => request.matches) };
}

const variants = [
  { name: 'lazy-partial', hashLoading: 'lazy' },
  { name: 'lazy-full-runtime-requirements', hashLoading: 'lazy', incremental: {
    chunksRuntimeRequirements: false, chunksHashes: false, chunkAsset: false,
  } },
  { name: 'eager-partial', hashLoading: 'eager' },
  { name: 'lazy-default-incremental', hashLoading: 'lazy', incremental: true },
];

async function reproduce(variant) {
  const directory = path.join(root, 'runs', variant.name);
  fs.rmSync(directory, { recursive: true, force: true });
  const src = path.join(directory, 'src');
  const dist = path.join(directory, 'dist');
  fs.cpSync(path.join(root, 'src'), src, { recursive: true });
  const config = makeConfig(rspack, src, dist, variant);
  const compiler = rspack.rspack(config);
  const captures = [];
  let rebuildRequested = false;
  let changeWritten = false;
  return await new Promise((resolve, reject) => {
    let watcher;
    const finish = error => {
      clearTimeout(timeout);
      watcher.close(closeError => error || closeError ? reject(error ?? closeError) : resolve({
        name: variant.name, config: { hashLoading: variant.hashLoading, incremental: config.incremental }, captures,
      }));
    };
    const timeout = setTimeout(() => finish(new Error(`${variant.name}: watch timeout`)), 120_000);
    watcher = compiler.watch({ aggregateTimeout: 30 }, async (error, stats) => {
      try {
        if (error) throw error;
        if (stats.hasErrors()) throw new Error(stats.toString({ all: false, errors: true }));
        // Ignore watcher startup notifications before the deliberate source edit.
        if (rebuildRequested && !changeWritten) return;
        const phase = rebuildRequested ? 'rebuild' : 'initial';
        const snapshot = path.join(directory, phase);
        fs.cpSync(dist, snapshot, { recursive: true });
        const execution = await loadBundle(snapshot);
        const aSource = fs.readFileSync(path.join(snapshot, 'a.js'), 'utf8');
        const statsData = stats.toJson({ all: false, modules: true, runtimeModules: true, logging: 'verbose', modulesSpace: Infinity });
        const logging = statsData.logging ?? {};
        captures.push({
          phase,
          aContainsLazyRegistration: aSource.includes('Object.assign(') && aSource.includes('.sriHashes'),
          reportedLazyModules: (statsData.modules ?? []).filter(module => module.name?.includes('sri_lazy')).map(module => ({ name: module.name, identifier: module.identifier })),
          incrementalLogs: Object.fromEntries(Object.entries(logging).filter(([name]) => name.includes('incremental'))),
          ...execution,
        });
        console.log(`${variant.name} ${phase}: value=${execution.value}, verified=${execution.allVerified}, A registers hashes=${captures.at(-1).aContainsLazyRegistration}`);
        assert.equal(execution.value, 'b:initial');
        assert.equal(execution.buildMarker, rebuildRequested ? 'updated' : 'initial');
        if (!rebuildRequested) {
          assert.equal(execution.allVerified, true, 'Initial build must verify both chunks');
          rebuildRequested = true;
          setTimeout(() => {
            changeWritten = true;
            const entry = path.join(src, 'index.js');
            fs.writeFileSync(entry, fs.readFileSync(entry, 'utf8').replace("buildMarker = 'initial'", "buildMarker = 'updated'"));
          }, 300);
        } else finish();
      } catch (error) { finish(error); }
    });
  });
}

const results = [];
for (const variant of variants) results.push(await reproduce(variant));
const report = {
  sourceCommit,
  node: process.version,
  results,
};
fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify(report, null, 2) + '\n');
assert.equal(results.find(result => result.name === 'lazy-full-runtime-requirements').captures[1].allVerified, true);
assert.equal(results.find(result => result.name === 'eager-partial').captures[1].allVerified, true);
assert.equal(results[0].captures[1].aContainsLazyRegistration, false);
assert.equal(results[0].captures[1].requests[0].matches, true, 'A itself must still pass SRI');
assert.equal(results[0].captures[1].requests[1].integrity, null, 'B loses its integrity');
assert.equal(results.find(result => result.name === 'lazy-default-incremental').captures[1].allVerified, true);
console.log(`\nEvidence: ${path.join(root, 'results.json')}`);
console.log(`Issue reproduced: ${!results[0].captures[1].allVerified}`);
