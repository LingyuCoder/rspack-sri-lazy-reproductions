import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeConfig, variants } from '../rspack.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = process.env.RSPACK_SOURCE;
assert(sourceRoot, 'Set RSPACK_SOURCE to a built checkout of PR #16374');
const sourceCommit = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceChanges = execFileSync('git', ['-C', sourceRoot, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
assert.equal(sourceCommit, 'ba2e2eef60d53a3ede5882c3cde08fc2a94a3fb6');
assert.equal(sourceChanges, '', 'Use the clean original PR source for this reproduction');
const rspack = await import(pathToFileURL(path.join(sourceRoot, 'packages/rspack/dist/index.js')));
const results = [];
for (const variant of variants) {
  const config = makeConfig(rspack, root, variant);
  const compiler = rspack.rspack(config);
  const stats = await new Promise((resolve, reject) => compiler.run((error, stats) => {
    compiler.close(closeError => error || closeError ? reject(error ?? closeError) : resolve(stats));
  }));
  if (stats.hasErrors()) throw new Error(stats.toString({ all: false, errors: true }));
  const data = stats.toJson({ all: false, assets: true, chunks: true, chunkModules: true, modules: true, runtimeModules: true, entrypoints: true, chunkGroups: true, warnings: true, modulesSpace: Infinity });
  const assets = Object.fromEntries(fs.readdirSync(config.output.path).map(file => {
    const source = fs.readFileSync(path.join(config.output.path, file), 'utf8');
    return [file, {
      initializesHashes: /\.sriHashes\s*=/.test(source),
      registersHashes: /Object\.assign\([^;]*\.sriHashes/.test(source),
      hashStrings: source.match(/sha256-[A-Za-z0-9+/]{43}=/g) ?? [],
    }];
  }));
  results.push({ ...variant, assets, stats: data });
  console.log(variant.name, JSON.stringify(assets));
}
fs.writeFileSync(path.join(root, 'build-results.json'), JSON.stringify({ sourceCommit, sourceChanges, results }, null, 2) + '\n');
