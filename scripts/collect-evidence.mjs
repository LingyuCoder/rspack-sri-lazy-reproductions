import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const build = read('build-results.json');
const browser = read('browser-results.json');
const incremental = read('cases/03-incremental-runtime-module/results.json');
const incrementalBrowser = read('cases/03-incremental-runtime-module/browser-results.json');
const evidence = {
  sourceCommit: build.sourceCommit,
  sourceWorktreeClean: build.sourceChanges === '',
  node: incremental.node,
  chromium: browser.chromium,
  staticBuilds: build.results.map(result => ({
    name: result.name,
    assets: result.assets,
    chunkGroups: result.stats.namedChunkGroups,
    chunks: result.stats.chunks.map(chunk => ({ names: chunk.names, files: chunk.files })),
    lazyRuntimeModules: result.stats.modules.filter(module => module.name?.includes('sri_lazy')).map(module => module.name),
  })),
  staticBrowser: browser.results,
  incrementalBuilds: incremental.results.map(result => ({
    name: result.name,
    config: result.config,
    captures: result.captures,
  })),
  incrementalBrowser: incrementalBrowser.results,
};
const text = JSON.stringify(evidence, null, 2).replace(/127\.0\.0\.1:\d+/g, '127.0.0.1:<port>') + '\n';
if (text.includes('/Users/') || text.includes('/home/')) throw new Error('Evidence must not contain local absolute paths');
fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
fs.writeFileSync(path.join(root, 'evidence/summary.json'), text);
console.log('Saved evidence/summary.json');
