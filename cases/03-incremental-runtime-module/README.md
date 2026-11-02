# An unchanged chunk loses its lazy runtime module on rebuild

The graph is [`src/index.js`](src/index.js) → dynamic import of [`src/a.js`](src/a.js) → dynamic import of [`src/b.js`](src/b.js).

The [configuration](rspack.config.mjs) enables lazy SRI explicitly in development and uses:

```js
cache: false,
incremental: {
  chunksRuntimeRequirements: true,
  chunksHashes: false,
  chunkAsset: false,
},
```

[`reproduce.mjs`](reproduce.mjs) runs a real watch build and changes only the entry's unrelated `buildMarker` assignment. A, B, and the dependency graph remain unchanged. There is no HMR.

Observed on the original PR:

1. Initial A contains `Object.assign(__webpack_require__.sriHashes, { b: ... })`, and both A and B have valid integrity values.
2. Rebuild recovers a chunk-graph snapshot from before runtime modules were attached. Incremental runtime requirements process only the affected entry (`1 chunks are affected, 3 in total`). A's per-chunk hook is skipped, so `sri_lazy_hashes_a` is not restored.
3. Regenerating A's asset drops the registration. A's own SRI remains valid, but B gets `integrity="undefined"`.
4. [`browser-check.mjs`](browser-check.mjs) confirms that Chromium now executes a tampered B, while it rejected the same tampering before rebuild.

Controls:

- Disable `chunksRuntimeRequirements`: A's registration survives and tampering is rejected.
- Use eager hashes with the same partial incremental configuration: tampering is rejected.
- Use `incremental: true`: in this example the missing module is masked by reuse of A's old emitted asset; this is not a claim that every default watch rebuild fails.

Run `npm run reproduce:incremental` from the repository root after following the [setup instructions](../../README.md#run). Inspect `incrementalBuilds` and `incrementalBrowser` in [the evidence](../../evidence/summary.json), or the generated `runs/<variant>/{initial,rebuild}/` files.
