# Dependency decisions

Standing decisions about dependency advisories and version pins, so a Dependabot or audit PR has somewhere durable to be closed against.
The gate is moderate and above: `yarn security:audit:production` plus the recursive audits in `.github/workflows/ci.yml`.
A low advisory below that gate is a judgement call, and the ones we have judged are recorded here.

## 2026-09-22: One low advisory is patched in range, one is accepted (#2392)

`node scripts/run-dependency-audit.mjs . server client -- --recursive --severity low` reported two, both in the server workspace and both reached only through the development toolchain, never through anything the server ships.
They needed opposite answers, and the discriminator is whether a patched version satisfies every parent's declared range.

**`diff` GHSA-73rr-hh4g-fpgx: patched, not accepted.**
The advisory is fixed in 4.0.4 and its only parent, `ts-node@10.9.2`, pins `diff@^4.0.1`, which 4.0.4 satisfies.
That makes it an ordinary patch bump rather than an override, so it is pinned through the server `resolutions` block alongside the other security pins there and the advisory is gone.
A transitive dependency will not move on `yarn up` because `up` only rewrites a workspace's own ranges, which is why this needs the `resolutions` entry rather than an upgrade command.

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
