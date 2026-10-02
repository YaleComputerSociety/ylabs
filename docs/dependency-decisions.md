# Dependency decisions

Standing decisions about dependency advisories and version pins, so a Dependabot or audit PR has somewhere durable to be closed against.
The gate is moderate and above: `yarn security:audit:production` plus the recursive audits in `.github/workflows/ci.yml`.
A low advisory below that gate is a judgement call, and the ones we have judged are recorded here.

## 2026-10-02: The lint toolchain moves to ESLint 10 (#4375)

`eslint` and `@eslint/js` are on 10, with `typescript-eslint` 8.71, `eslint-plugin-react-hooks` 7, `eslint-config-prettier` 10 and `globals` 17.
`typescript-eslint` 8.71 declares `typescript >=4.8.4 <6.1.0`, so the installed TypeScript 5.9 is supported; TypeScript 7 waits on a `typescript-eslint` release that admits it.
The `.yarnrc.yml` ignore for `eslint (deprecation)` is removed, because its exit condition was this move, and every moderate audit stays clean without it.

`eslint-plugin-react` is removed rather than upgraded.
Its latest release declares no ESLint 10 peer range, and the config enabled none of its rules: it only switched off two JSX-scope rules that were never on.

The root `brace-expansion@npm:^1.1.7` override is removed with it.
That range was requested only by `minimatch` 3, which only the ESLint 9 toolchain loaded, and ESLint 10 loads `minimatch` 10, so the override matched nothing and the dead-override guard in `scripts/security-preflight.test.mjs` failed on it.
The `^5.0.5` override still matches and stays.

ESLint 10's `@eslint/js` recommended set adds `no-useless-assignment` and `preserve-caught-error`, and both findings were fixed in source: dead initializers before a `try` are gone, and a rethrown error now carries the caught one as its `cause`.
The `eslint-plugin-react-hooks` recommended config is adopted whole, except `react-hooks/refs` and `react-hooks/set-state-in-effect`, which stay at `warn` because they flag loader effects and latest-value refs that are correct without the React Compiler; #4379 clears them and restores `error`.

## 2026-09-30: Dead overrides, a spent advisory ignore and `ts-node` are removed (#4037)

An override that matches nothing reads as a security pin, so nobody removes it and every dependency review re-derives that it does nothing.
The root `resolutions` for `form-data`, `axios`, `underscore`, `path-to-regexp`, `uuid`, and `xml2js` matched no root lockfile entry, because `server` and `client` are separate Yarn projects that root `resolutions` never reach, and the `server` `braces` pin matched no `server` lockfile entry.
All seven are removed, and `scripts/security-preflight.test.mjs` now fails when any workspace declares an override its own lockfile does not resolve.

The `.yarnrc.yml` ignore for GHSA-qwww-vcr4-c8h2 (advisory 1124282) is removed, because its 7.x range ends below 7.18.2 and the client installs 7.18.2; the moderate audits stay clean without it.
The `client` `react-router` pin is removed too: `react-router-dom` pins its own exact `react-router`, and the client's `^7.18.2` floor already keeps both on the patched release, so the lockfile is byte-identical without it.

`ts-node` had no caller, since the server runs everything through `tsx`, and it was the only parent of `diff`, so both it and the `diff` 4.0.4 pin recorded below are gone.
`domhandler`, `bson`, and `@eslint/js` were imported without being declared and are now declared at the versions already resolved.

## 2026-09-30: `brace-expansion` is pinned per major in the root project (#4033)

The `brace-expansion` advisories (GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7) are patched on every major line: 1.1.21, 2.1.7, 3.0.9, and 5.0.12.
The root `resolutions` once forced 5.0.12 onto every consumer, which included the `minimatch` 3 that ESLint's `@eslint/config-array` loads.
`minimatch` 3 calls `brace-expansion` as a CommonJS default function and 5.x exports only named bindings, so any brace glob crashed ESLint with `expand is not a function`.

The root override is now keyed by the declared range, `brace-expansion@npm:^1.1.7` to 1.1.21 and `brace-expansion@npm:^5.0.5` to 5.0.12, so each consumer gets a patched release of the major it was written for.
The `server` and `client` pins stay unscoped, because both resolve only `minimatch` 10.
`scripts/security-preflight.test.mjs` pins both halves: every locked `brace-expansion` in the three lockfiles must be on the patched floor of its own major, and the `minimatch` ESLint loads must match a brace set.
A new parent that declares a range neither key covers resolves unpinned, and the first of those guards fails if the version it locks is not patched.

## 2026-09-30: Action pins are maintained by a grouped Dependabot updater (#3914)

Every third-party action is pinned to a commit SHA, which is right, and which also means nothing proposes an update to it.
There was no `.github/dependabot.yml`, so the pins stayed frozen until someone edited them by hand, and they had drifted onto a runtime GitHub deprecated: every run logged that the pinned actions target Node 20 and were being forced onto a newer runtime.

`.github/dependabot.yml` now declares a `github-actions` updater for directory `/`, weekly, with every action grouped into one pull request.
Three things about it are deliberate.

- **It targets `beta`.** Pull requests are based on `beta` here, so an updater left on the default target would open against the production branch.
- **The pins stay SHAs.** Dependabot rewrites the SHA and the `# vX.Y.Z` comment beside it together, so the comment is load-bearing rather than decoration: a pin without it gets no update proposal at all.
  `scripts/security-preflight.test.mjs` pins both halves, so a tag pin and a stripped comment each fail the build.
- **The bump is grouped.** One pull request a week for all actions, rather than one per action, because they move together and a reviewer reads them together.

The three actions in use were bumped in the same change to releases that target the current runtime, which removes the deprecation warning from every run.
The updater is what keeps that true without another manual pass.

## 2026-09-22: One low advisory is patched in range, one is accepted (#2392)

`node scripts/run-dependency-audit.mjs . server client -- --recursive --severity low` reported two, both in the server workspace and both reached only through the development toolchain, never through anything the server ships.
They needed opposite answers, and the discriminator is whether a patched version satisfies every parent's declared range.

**`diff` GHSA-73rr-hh4g-fpgx: patched, not accepted.**
The advisory is fixed in 4.0.4 and its only parent, `ts-node@10.9.2`, pins `diff@^4.0.1`, which 4.0.4 satisfies.
That makes it an ordinary patch bump rather than an override, so it is pinned through the server `resolutions` block alongside the other security pins there and the advisory is gone.
A transitive dependency will not move on `yarn up` because `up` only rewrites a workspace's own ranges, which is why this needs the `resolutions` entry rather than an upgrade command.
`ts-node` and this pin were removed together on 2026-09-30 (#4037), so `diff` is no longer installed at all.

**`esbuild` GHSA-g7r4-m6w7-qqqr: accepted.**

| Advisory | Reached through | Why it is accepted |
|---|---|---|
| `esbuild` 0.27.7, vulnerable `>=0.27.3 <0.28.1` | two parents: `tsup@8.5.1` pinning `esbuild@^0.27.0`, and `tsx@4.21.0` pinning `esbuild@~0.27.0` | The fixed 0.28.1 satisfies neither range, so pinning it would substitute a minor version neither parent has been tested against. The advisory itself is an arbitrary file read by esbuild's development server on Windows, and we neither run that server nor build on Windows. |

At `--severity moderate`, the gate's threshold, all three workspaces were clean before this change and remain so.

Revisit `esbuild` when every parent widens its range, which is what turns the upgrade into a normal one: `npm view tsup dependencies.esbuild` and `npm view tsx dependencies.esbuild`.
`tsx`'s `~0.27.0` is the tighter of the two, so it alone pins the minor and `tsup` widening on its own changes nothing.
Revisit sooner if the advisory is re-scored at moderate or above, because then it is the gate's decision rather than ours.

The general rule this leaves behind: check whether a patched version satisfies every parent range before recording an advisory as accepted.
An advisory that is fixable in range is a lockfile pin, and only one that is not is a judgement call.
