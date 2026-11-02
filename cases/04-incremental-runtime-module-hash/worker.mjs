import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeConfig, variants } from './rspack.config.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const variant = variants.find(variant => variant.name === process.argv[2]);
if (!variant) throw new Error('Unknown variant');
const sourceRoot = process.env.RSPACK_SOURCE;
const rspack = await import(pathToFileURL(path.join(sourceRoot, 'packages/rspack/dist/index.js')));
const directory = path.join(root, 'runs', variant.name);
fs.rmSync(directory, { recursive: true, force: true });
const context = path.join(directory, 'src');
fs.cpSync(path.join(root, 'src'), context, { recursive: true });
fs.writeFileSync(path.join(context, 'package.json'), '{"private":true}\n');
for (const file of fs.readdirSync(context)) {
  const past = new Date(Date.now() - 5_000);
  fs.utimesSync(path.join(context, file), past, past);
}
const outputPath = path.join(directory, 'dist');
const config = makeConfig(rspack, context, outputPath, variant);
const send = message => process.send?.(message);
let phase = 'initial';

config.plugins.push({ apply(compiler) {
  compiler.hooks.thisCompilation.tap('CaptureRuntimeModules', compilation => {
    compilation.hooks.afterProcessAssets.tap('CaptureRuntimeModules', () => {
      const main = compilation.assets['main.js']?.source().toString() ?? '';
      const mainContainsUpdatedMarker = main.includes("'updated'") || main.includes('"updated"');
      const stats = compilation.getStats().toJson({
        all: false, modules: true, runtimeModules: true, modulesSpace: Infinity, logging: 'verbose',
      });
      send({
        event: 'after-process-assets',
        phase,
        mainContainsUpdatedMarker,
        modifiedFiles: [...(compiler.modifiedFiles ?? [])].map(file => path.basename(file)),
        lazyRuntimeModules: (stats.modules ?? []).filter(module => module.name?.includes('sri_lazy')).map(module => module.name),
        incrementalLogs: Object.fromEntries(Object.entries(stats.logging ?? {}).filter(([name]) => name.includes('incremental'))),
      });
    });
  });
} });

const compiler = rspack.rspack(config);
const run = options => new Promise((resolve, reject) => compiler.run((error, stats) => {
  if (error) return reject(error);
  if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })));
  resolve(stats);
}, options));
const timeout = setTimeout(() => process.exit(2), 30_000);
try {
  await run();
  send({ event: 'build-callback', phase: 'initial' });
  const entry = path.join(context, 'index.js');
  fs.writeFileSync(entry, fs.readFileSync(entry, 'utf8').replace("buildMarker = 'initial'", "buildMarker = 'updated'"));
  send({ event: 'entry-edit', change: "buildMarker: 'initial' -> 'updated'; imports unchanged" });
  phase = 'rebuild';
  // Compiler.run uses the same native rebuild entry point as watch after its
  // first build. Explicit changed files avoid watcher setup notifications.
  await run({ modifiedFiles: new Set([entry]), removedFiles: new Set() });
  const main = fs.readFileSync(path.join(outputPath, 'main.js'), 'utf8');
  assert(main.includes("'updated'") || main.includes('"updated"'), 'Rebuild must include the entry edit');
  send({ event: 'build-callback', phase: 'rebuild' });
  await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
  send({ event: 'complete' });
} catch (error) {
  send({ event: 'error', message: String(error) });
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  process.disconnect?.();
}
