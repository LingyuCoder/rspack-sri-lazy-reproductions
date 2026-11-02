# Recreated lazy runtime modules have no hash on an incremental rebuild

This case targets the follow-up fix commit [`dedf6dffccf250150ec6d3820e6a892468728c3a`](https://github.com/web-infra-dev/rspack/commit/dedf6dffccf250150ec6d3820e6a892468728c3a). Cases 01–03 target the earlier `ba2e2ee` revision instead.

The dependency graph is [`src/index.js`](src/index.js) → dynamic import of [`src/a.js`](src/a.js) → dynamic import of [`src/b.js`](src/b.js).
The [configuration](rspack.config.mjs) uses development incremental compilation without HMR, `cache: false`, lazy SRI with `enabled: true`, and **`incremental: true`**.

After a successful initial build, the worker changes only the entry's unrelated `buildMarker` assignment from `'initial'` to `'updated'`. A, B, and all imports remain unchanged.

## Run

Point `RSPACK_SOURCE` at a clean checkout of `dedf6dff` with its native binding and JS package already built, following Rspack's development instructions:

```sh
export RSPACK_SOURCE=/absolute/path/to/rspack-at-dedf6dff
# From this reproduction repository:
npm run reproduce:hash-records
```

No browser or project-specific dependency installation is required. The worker calls `compiler.run()` twice on the same compiler and supplies the edited entry through `modifiedFiles` on the second call. Subsequent `run()` calls use the same native rebuild entry point as watch; this avoids filesystem-watcher startup notifications. The parent launches each variant in a separate Node process so that a native abort cannot prevent the control runs or destroy the collected evidence.

## Failure path

1. The new SRI fix disables incremental `chunksRuntimeRequirements`, so the unchanged A's lazy runtime module is recreated on rebuild.
2. Incremental `chunksHashes` is still enabled. Only the entry is affected, so the hash phase skips A and its newly recreated runtime module.
3. The new compilation starts with an empty `runtime_modules_hash` map; that map is not recovered from the previous compilation.
4. Rebuild records enumerate all runtime modules and call `.expect("should have runtime module hash")` for A's missing hash. The native process aborts before the rebuild callback completes.

Relevant code at the pinned revision:

- [Only the runtime requirements pass is disabled](https://github.com/web-infra-dev/rspack/blob/dedf6dffccf250150ec6d3820e6a892468728c3a/crates/rspack_plugin_sri/src/lib.rs#L138).
- [Runtime module hashing is limited to affected non-runtime chunks](https://github.com/web-infra-dev/rspack/blob/dedf6dffccf250150ec6d3820e6a892468728c3a/crates/rspack_core/src/compilation/create_hash/mod.rs#L159).
- [Rebuild records require every runtime module's hash](https://github.com/web-infra-dev/rspack/blob/dedf6dffccf250150ec6d3820e6a892468728c3a/crates/rspack_core/src/compiler/rebuild.rs#L198).

## Controls and assertions

| Variant | Difference | Expected rebuild result |
| --- | --- | --- |
| `lazy-default-incremental` | None | Native abort with `should have runtime module hash` |
| `lazy-full-chunk-hashes` | `incremental: { chunksHashes: false }` | Completes |
| `eager-default-incremental` | `hashLoading: 'eager'` | Completes |
| `lazy-no-incremental` | `incremental: false` | Completes |

The assertions require the initial build and deliberate entry edit to precede the failure, capture A's recreated module after asset processing, match the specific native panic, and require all three controls to finish their rebuild callbacks successfully. A different failure does not count as reproduction.

[`worker.mjs`](worker.mjs) runs each actual incremental build and emits progress events. [`reproduce.mjs`](reproduce.mjs) captures exit status, signal, stderr/backtrace, module names, and incremental logs; it removes machine-specific paths before writing [`evidence/04-runtime-module-hash.json`](../../evidence/04-runtime-module-hash.json).

As with cases 01–03, successful assertions mean the defect and controls were observed, not that the compiler was fixed. Generated workspaces under `runs/` are ignored by Git. The example is a compilation/rebuild failure and does not need to execute browser assets.

## Verified result

On `dedf6dff` with Node 22.16.0 on macOS arm64, the default lazy/incremental worker terminated with `SIGABRT` and `should have runtime module hash`. Its rebuilt entry contained the updated marker and its runtime module list contained `sri_lazy_hashes_a` before the abort. All three controls completed with exit code 0. No browser, HTTP server, or page request was used.
