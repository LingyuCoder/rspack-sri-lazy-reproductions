import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { variants } from './rspack.config.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, '../..');
const sourceRoot = process.env.RSPACK_SOURCE;
assert(sourceRoot, 'Set RSPACK_SOURCE to a built checkout of PR head dedf6dff');
const expectedCommit = 'dedf6dffccf250150ec6d3820e6a892468728c3a';
const sourceCommit = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(sourceCommit, expectedCommit, 'Case 04 targets the follow-up fix commit, not the original PR');
assert.equal(execFileSync('git', ['-C', sourceRoot, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '', 'Use the clean PR head');
const require = createRequire(path.join(sourceRoot, 'packages/rspack/package.json'));
const bindingModule = require.resolve('@rspack/binding');
assert(bindingModule.startsWith(sourceRoot + path.sep), 'The JS package must resolve this checkout\'s binding');

const results = [];
for (const variant of variants) {
  const result = await new Promise((resolve, reject) => {
    const messages = [];
    let stdout = '';
    let stderr = '';
    // Isolate native aborts, so the parent can retain evidence and run controls.
    const child = fork(path.join(root, 'worker.mjs'), [variant.name], {
      cwd: repo,
      env: { ...process.env, RUST_BACKTRACE: '1' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    child.on('message', message => messages.push(message));
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    const timeout = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ name: variant.name, config: { hashLoading: variant.hashLoading, incremental: variant.incremental }, code, signal, messages, stdout, stderr });
    });
  });
  results.push(result);
  console.log(`${result.name}: exit=${result.code}, signal=${result.signal}, missingModuleHash=${result.stderr.includes('should have runtime module hash')}`);
}

const scrub = value => value.replaceAll(sourceRoot, '<rspack>').replaceAll(repo, '.').replaceAll(os.homedir(), '<home>');
const evidence = {
  sourceCommit,
  sourceWorktreeClean: true,
  bindingModule: path.relative(sourceRoot, bindingModule),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  results,
};
const text = scrub(JSON.stringify(evidence, null, 2)) + '\n';
assert(!text.includes('/Users/') && !text.includes('/home/'), 'Remove machine-specific paths from evidence');
const evidencePath = path.join(repo, 'evidence/04-runtime-module-hash.json');
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, text);

for (const [index, result] of results.entries()) {
  assert(result.messages.some(message => message.event === 'build-callback' && message.phase === 'initial'), `${result.name}: initial build must succeed`);
  assert(result.messages.some(message => message.event === 'entry-edit'), `${result.name}: source edit must precede the outcome`);
  if (variants[index].expectPanic) {
    assert(result.code !== 0 || result.signal !== null, 'Expected the native process to fail on rebuild');
    assert(result.stderr.includes('should have runtime module hash'), 'Expected the specific missing-runtime-module-hash panic');
    assert(result.messages.some(message => message.event === 'after-process-assets' && message.phase === 'rebuild' && message.mainContainsUpdatedMarker === true && message.lazyRuntimeModules.some(name => name.includes('sri_lazy_hashes_a'))), 'The unchanged chunk\'s module must have been recreated before the panic');
    assert(!result.messages.some(message => message.event === 'build-callback' && message.phase === 'rebuild'), 'Panic must prevent completion of the rebuilt compilation');
  } else {
    assert.equal(result.code, 0, `${result.name}: control must complete`);
    assert.equal(result.signal, null);
    assert(result.messages.some(message => message.event === 'build-callback' && message.phase === 'rebuild'), `${result.name}: rebuild callback must complete`);
  }
}
console.log('Case 04 reproduced; all three controls passed. Evidence: evidence/04-runtime-module-hash.json');
