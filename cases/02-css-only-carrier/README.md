# A CSS-only primary chunk cannot execute lazy hash registration

[Original review thread](https://github.com/web-infra-dev/rspack/pull/16374#discussion_r4439335291).

The graph is [`main.js`](main.js) → dynamic import of [`a.js`](a.js) → dynamic import of [`b.js`](b.js). A also imports native [`style.css`](style.css).

The common [configuration](../../rspack.config.mjs) extracts only A's JavaScript:

```js
splitChunks: {
  chunks: 'async',
  minSize: 0,
  cacheGroups: {
    extractedJs: { test: /[/\\]a\.js$/, name: 'a-code', enforce: true },
  },
}
```

On the first production build with lazy hashes:

1. Chunk group `a` is `["a-code", "a"]`. `a-code` emits `a-code.js`; the last chunk `a` emits only `a.css`.
2. Compilation stats contain `webpack/runtime/sri_lazy_hashes_a`, but there is no `a.js` to execute it. No emitted JavaScript contains the lazy update for B.
3. A's JS and CSS have valid integrity values. B's script gets the literal DOM value `integrity="undefined"`.
4. Chromium reports invalid integrity metadata and executes B even when the server has appended a tampering marker.

Controls in the same run:

- `css-carrier-eager` retains splitChunks but uses eager hashes; it rejects tampered B.
- `css-carrier-lazy-no-split` retains lazy hashes but disables splitChunks; A emits JS and registers B's hash, so tampered B is rejected.

Run `npm run reproduce:static` from the repository root after following the [setup instructions](../../README.md#run). Inspect `css-carrier-*` in [the evidence](../../evidence/summary.json), or the generated `dist/css-carrier-*/` files.
