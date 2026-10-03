# Dependency decisions

Standing decisions about dependency advisories and version pins, so a Dependabot or audit PR has somewhere durable to be closed against.
The gate is moderate and above: `yarn security:audit:production` plus the recursive audits in `.github/workflows/ci.yml`.
A low advisory below that gate is a judgement call, and the ones we have judged are recorded here.

## 2026-10-02: The client moves to Tailwind CSS 4 and drops `autoprefixer` (#4386)

`tailwindcss` is on 4.3 and runs as the `@tailwindcss/vite` plugin, so `postcss.config.js`, `tailwind.config.js`, and `autoprefixer` are removed; Tailwind 4 prefixes through Lightning CSS.
`postcss` stays as a client devDependency, because the design-token guards parse the compiled stylesheet with it, and its `resolutions` pin stays.
`@tailwindcss/node` and `@tailwindcss/oxide` are explicit devDependencies rather than transitive ones, because `client/src/testUtils/tailwind.ts` compiles and scans with them directly.
The client `tsconfig.json` moves to `moduleResolution: "bundler"`, the Vite-recommended setting, because those packages publish their types only through `exports`.
How the upgrade was held to no visual change is recorded in `docs/decisions.md` under the same issue.

## 2026-10-02: TypeScript moves to 6.0, and TypeScript 7 is held (#4433)

`typescript` is on 6.0.3 in the root, `client`, and `server` projects, up from 5.9.3.
TypeScript 7 (7.0.2) is held, because `typescript-eslint` 8.71, the newest release, declares a `typescript >=4.8.4 <6.1.0` peer range, so the lint toolchain would parse with a compiler it does not support.
The exit condition is a `typescript-eslint` release whose `typescript` peer range admits 7.x; that is when the TypeScript 7 step of #4038 can start.
TypeScript 6.0 is the release that deprecates what 7.0 removes, so each `tsconfig.json` was moved onto the 6.0 defaults without `ignoreDeprecations`, which leaves no deprecated option for the TypeScript 7 move to clear.

- The client's `moduleResolution: node` (now named `node10`) is deprecated, and it becomes `bundler`, which is how Vite resolves.
- The client adds `vite/client` to `types`, because 6.0 turns on `noUncheckedSideEffectImports` and that file is what declares `import './index.css'`.
- `esModuleInterop` and `allowSyntheticDefaultImports` are removed, because 6.0 always enables them and setting either to `false` is an error; the client's `dom.iterable` lib is removed, because 6.0 folds it into `dom`.
- The server's `outDir` and its emit-only options are replaced by `noEmit`, because `tsup` builds the server and `tsc` only type-checks it.
  Under 6.0 `rootDir` defaults to the `tsconfig.json` directory, and the server program includes the client modules that server tests import, so an `outDir` made that a `rootDir` error even under `--noEmit`.

The one new type error was a `??` whose left side could never be nullish, in `server/src/scripts/engineBenchmarkRun.ts`, and the unreachable fallback is removed.
`tsup`, `tsx`, `vite`, and `vitest` all run unchanged, because they transpile with their own transformers and read only the `tsconfig.json` fields that did not change.

## 2026-10-02: The remaining small majors move, and `domhandler` stays on 5 (#4434)

`@testing-library/jest-dom` moves to 7, `concurrently` to 10, and `js-yaml` to 5.
`jest-dom` 7 only makes `@testing-library/dom` a required peer, which the client already declares, and raises its Node floor to 22.
`concurrently` 10 is ESM-only and drops `--name-separator` and `killOthers`, none of which the root `start` script uses.
`js-yaml` 5 has no default export, so `scripts/security-preflight.test.mjs`, its only consumer, imports the namespace; its loader now defaults to the YAML 1.2 core schema and throws on empty input, and every lockfile and workflow the preflight parses loads the same.
The root `js-yaml` override moves with the direct pin, so the override still matches the one copy installed.

`domhandler` is held on 5.0.3.
The server imports it only for the `AnyNode` and `Element` types it annotates cheerio nodes with, and `cheerio` 1.2.0, the latest release, still depends on `domhandler` ^5.0.3 and `htmlparser2` 10.
Declaring 6 installs a second copy beside cheerio's, so those annotations would describe a different release from the nodes cheerio builds; it typechecks today only because the two shapes still match.
Revisit when `cheerio` moves to `htmlparser2` 12 and `domhandler` 6: `npm view cheerio dependencies.domhandler`.

Four others behind their latest are left where they are.
`mongodb` stays on `~7.6` rather than 7.7, because it tracks the driver line Mongoose 9.10 pins, as recorded below.
`eslint` 10.12, `@sentry/node` 11.3 and 11.4, and `@sentry/react` 11.3 and 11.4 were published less than a day before this change, so `npmMinimalAgeGate` refuses them; they are ordinary minor bumps for the next pass.

## 2026-10-02: The client moves to MUI 9 and drops `sweetalert` (#4383)

`@mui/material` moves from 7 to 9, with `@emotion/react` and `@emotion/styled` on their current 11.x.
There is no MUI 8 release: MUI went from 7 to 9 to align its major with MUI X, so the v7 to v9 migration guide is the whole path.
Its codemods (`deprecations/all` and `v9.0.0/system-props`) change nothing here, because every MUI call site already used `slots` and `slotProps`, and the navbar, user menu, and mobile drawer render pixel-identically before and after.
MUI 9 raises its own bundle targets to Chrome 117, Firefox 121, and Safari 17, but Vite transpiles dependencies to the build target, so the shipped browser floor is unchanged.

`sweetalert` 2.1.2 is removed, because it had no release in years.
Its alerts and confirmations now go through `showAlert` and `confirmAction` in `client/src/utils/appDialogs.tsx`, a small shared dialog on MUI `Dialog`; `client/DESIGN.md` §4 records its contract.
Two consequences of moving onto an MUI modal are deliberate.
The dialog sets `disableScrollLock`, because pages scroll inside `[data-scroll-container]` rather than the body, and MUI's lock restored a stale inline `overflow: hidden` after the admin fellowship edit modal had cleared it.
The client test setup mocks the dialog module by default, because the dialog mounts its own React root outside Testing Library's cleanup and an open MUI modal hides every sibling from the accessibility tree, so a dialog that one test opened late hid the next test's render; the dialog's own test unmocks it.

## 2026-10-02: The server moves to Mongoose 9 and MongoDB driver 7 (#4376)

`mongoose` is on 9.10 in the root and `server` projects, and the server's direct `mongodb` dependency moves from `~6.20` to `~7.6`, the line Mongoose 9.10 pins, so the server and Mongoose share one shipped driver.
`bson` moves to 7.3 with it and is deduplicated onto the copy the driver resolves, so an `ObjectId` built from the direct import and one from the driver are the same class.
`mongodb-memory-server` moves to 11.3, whose core still pins `mongodb@~7.5.0`; that second driver copy is development-only and installed only for the in-memory test server, as the 6.x one was before.

The migration kept every query's runtime behaviour.
The `insertMany` and `bulkWrite` provenance guards were rewritten without `next()`, because under Mongoose 9 their first argument is the documents rather than a callback and the old form would have thrown on every such write.
`new: true` became `returnDocument: 'after'`, the one Model-level update pipeline (a test) passes `updatePipeline: true`, and `FilterQuery` became `QueryFilter`.
The stricter filter typing rejected widened literals and `unknown` ids from loosely typed lean rows, which are now typed at the call site, and reads that still match the retired `researchGroup` observation subject go through the shared `researchEntityObservationSubjects` constant in `models/observation.ts`.
`Document.prototype.validateSync()` is deprecated for Mongoose 10 and is still used by model tests; moving them to `validate()` is left for that upgrade.

## 2026-10-02: The server moves to Express 5 and drops its `path-to-regexp` pin (#4374)

The `server` `resolutions` pinned `path-to-regexp` to 0.1.13, the patched release of the route matcher Express 4's router used.
Express 5 routes through `router` 2, which depends on `path-to-regexp` 8, so the pin would have forced a matcher the router was never written for, and it is removed rather than moved.
`@types/express` moves to 5 with it, and the copies that `@types/passport`, `@types/passport-strategy`, and `@types/cookie-session` pull through their `*` ranges are deduplicated onto the same release, so one Express type surface is installed.
The `qs` pin stays, because Express 5 and `body-parser` 2 both still resolve it.
The behaviour this upgrade had to keep, and where each rule now lives, is recorded in `skills/auth-security/SKILL.md` under the Express 5 request contract.

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

## 2026-10-02: The http-cache-semantics advisory is accepted until a fix is published

GHSA-ch52-4w7c-c8xp (advisory 1240991, high) was published against `http-cache-semantics` `<=4.2.0`, and 4.2.0 is the latest release, so no version satisfies the fix.
It reached the server workspace directly and through `make-fetch-happen`, and the security preflight failed every pull request on it.
The advisory is a cross-user disclosure through `max-stale` handling in a shared cache.
The server uses the package only in `scrapers/utils/httpValidatorCache.ts`, the scraper's local validator cache for its own anonymous fetches of public pages; a request carrying an `authorization` or `cookie` header bypasses it, and nothing the cache stores is ever served to a user, so there is no second user to disclose to.
It is suppressed in `.yarnrc.yml` by advisory id with that justification.
Remove the suppression as soon as a patched release is published: `npm view http-cache-semantics version`.

The same day GHSA-vfj7-8cjw-p6xm against `braces` `<=3.0.3` (advisory 1240992, high), a stack-exhaustion denial of service through deeply nested patterns, failed the all-environments audit, and 3.0.3 is also the latest release.
It reaches only the client's build tooling, through `chokidar` and `micromatch`, which expand glob patterns written in this repository and never a pattern a user supplies, so it is suppressed on the same terms.
Remove it once a patched release is published: `npm view braces version`.

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
