# Initial entry group updates an uninitialized hash map

[Original review thread](https://github.com/web-infra-dev/rspack/pull/16374#discussion_r4439335279).

The minimal inputs are [`shared.js`](shared.js) and [`main.js`](main.js). The common [configuration](../../rspack.config.mjs) uses:

```js
entry: {
  shared: './shared.js',
  main: { import: './main.js', dependOn: 'shared' },
},
optimization: { runtimeChunk: 'single', minimize: false },
// SubresourceIntegrityPlugin: hashLoading: 'lazy'
```

There are no async JavaScript chunks. On the first production build:

1. `runtime.js` does not initialize `__webpack_require__.sriHashes`.
2. `shared.js` contains `Object.assign(__webpack_require__.sriHashes, { main: ... })`.
3. Chromium throws `TypeError: Cannot convert undefined or null to object`; `main` does not initialize `globalThis.startup`.

Controls in the same run:

- `depend-on-eager` starts correctly with eager hashes.
- `depend-on-lazy-with-async` adds [`extra-entry.js`](extra-entry.js), causing the runtime to initialize the map, and starts correctly.

Run `npm run reproduce:static` from the repository root after following the [setup instructions](../../README.md#run). Inspect the `depend-on-*` entries in [the evidence](../../evidence/summary.json), or the generated `dist/depend-on-*/` files.
