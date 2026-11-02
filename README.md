# Rspack lazy SRI reproductions

Three independent reproductions for [Rspack PR #16374](https://github.com/web-infra-dev/rspack/pull/16374), verified against the unmodified commit [`ba2e2eef60d53a3ede5882c3cde08fc2a94a3fb6`](https://github.com/web-infra-dev/rspack/commit/ba2e2eef60d53a3ede5882c3cde08fc2a94a3fb6).

| Case | Trigger | Observed result |
| --- | --- | --- |
| [01: Initial entry group](cases/01-initial-entry-group) | `dependOn`, a separate runtime, no async JS chunks | Startup throws because a lazy update targets an uninitialized hash map. |
| [02: CSS-only carrier](cases/02-css-only-carrier) | Split A's JavaScript into an earlier chunk while leaving CSS in the primary chunk | B receives `integrity="undefined"`; Chromium executes a tampered B. |
| [03: Incremental runtime module](cases/03-incremental-runtime-module) | Incremental runtime requirements skip an unchanged chunk whose asset is regenerated | The lazy registration disappears after rebuild; Chromium executes a tampered B. |

Each case has controls. Cases 01 and 02 reproduce on the first production build with incremental compilation disabled. Case 03 uses development watch without HMR.

## Run

This repository has no npm dependencies of its own. It loads the compiler and Playwright from a separately built Rspack checkout. A published Rspack package does not necessarily contain this PR.

Prepare the exact compiler revision using its documented Rust, Node.js, and pnpm versions:

```sh
git clone --filter=blob:none https://github.com/web-infra-dev/rspack.git rspack-pr16374
cd rspack-pr16374
git fetch origin pull/16374/head
git checkout --detach ba2e2eef60d53a3ede5882c3cde08fc2a94a3fb6
pnpm install --frozen-lockfile
pnpm run build:cli:dev
export RSPACK_SOURCE="$PWD"
```

Use an existing Chromium executable:

```sh
export CHROMIUM_EXECUTABLE=/absolute/path/to/chromium
```

Alternatively, install Playwright's matching Chromium once with `pnpm --dir "$RSPACK_SOURCE/tests/e2e" exec playwright install chromium`, and leave `CHROMIUM_EXECUTABLE` unset. Preparing dependencies or the browser may require network access. The reproduction pages themselves load only from a temporary `127.0.0.1` server; page requests to other hosts are blocked.

From this repository:

```sh
npm run reproduce
```

Or run the two first-build cases and the watch case separately:

```sh
npm run reproduce:static
npm run reproduce:incremental
```

The assertions expect the original PR's defective behavior and the controls' correct behavior. A successful run confirms the reproductions; it does not mean the defects are fixed.

## Evidence

[`evidence/summary.json`](evidence/summary.json) contains the compiler SHA, source-cleanliness check, Node/Chromium versions, chunk layouts, runtime module names, integrity values, rebuild logs, and browser outcomes. It omits machine-specific absolute paths. Full locally generated stats and emitted assets are ignored by Git.

The browser checks append only `globalThis.tampered = true` to B after bundling, without updating its integrity metadata. Initial entry scripts receive correct integrity values computed from the emitted files. The checks verify both normal loading and whether this harmless tampering executes.

The Node VM in case 03 records the emitted runtime's integrity assignments and checks their SHA-256 values. Browser SRI enforcement is verified separately in Chromium.

Each run replaces only this repository's generated `dist/` and case 03's `runs/` directories. The temporary HTTP servers and browsers are closed when checks finish.
