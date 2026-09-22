# Dependency decisions

Standing decisions about dependency advisories and version pins, so a Dependabot or audit PR has somewhere durable to be closed against.
The gate is moderate and above: `yarn security:audit:production` plus the recursive audits in `.github/workflows/ci.yml`.
A low advisory below that gate is a judgement call, and the ones we have judged are recorded here.

## 2026-09-22: Two low advisories are accepted rather than force-resolved (#2392)

`node scripts/run-dependency-audit.mjs . server client -- --recursive --severity low` reports exactly two, both in the server workspace and both reached only through a build-time dependency:

| Package | Advisory | Reached through | Why it is accepted |
|---|---|---|---|
| `diff` 4.0.2 | GHSA-73rr-hh4g-fpgx | `ts-node@10.9.2`, which pins `diff@^4.0.1` | The vulnerable entry points are `parsePatch` and `applyPatch`, which nothing in `ts-node`'s shipped output calls. |
| `esbuild` 0.27.7 | GHSA-g7r4-m6w7-qqqr | `tsup@8.5.1`, which pins `esbuild@^0.27.0` | The advisory is an arbitrary file read by esbuild's development server on Windows. We neither run that server nor build on Windows. |

At `--severity moderate`, the gate's threshold, all three workspaces are clean.

Neither package appears in any workspace's `resolutions`, and that is deliberate.
Forcing a resolution past a parent's declared range substitutes a version the parent has not been tested against, which trades a low unreachable advisory for an untested build toolchain.

Revisit when either parent widens its range, which is the only change that makes the upgrade a normal one: `npm view ts-node dependencies.diff` and `npm view tsup dependencies.esbuild`.
Revisit sooner if either advisory is re-scored at moderate or above, because then it is the gate's decision rather than ours.
