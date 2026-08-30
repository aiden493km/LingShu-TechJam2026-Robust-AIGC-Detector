# Local WebDemo acceptance evidence

This directory holds the committed, reproducible evidence for the offline FP32
WebDemo. `latest.json` is generated only after both real-browser suites pass; do
not edit it by hand.

## Current recorded result

The committed report currently records a passing Windows 11 / Microsoft Edge run:

| Gate | Recorded result |
|---|---:|
| Browser inference matrix | 90/90 images passed across source and Unicode fresh-copy runs |
| Execution paths | WebGPU, automatic WASM fallback, and forced WASM |
| Maximum absolute probability error | `0.002465222` (gate `<= 0.01`) |
| Frozen-threshold flips | `0` |
| Browser/Python tensor parity | 15/15 images |
| Worst mean tensor error | `0.006058` (gate `<= 0.02`) |
| Worst maximum tensor error | `0.418301` (gate `<= 0.50`) |
| Port fallback | occupied 8765 selected 8766 successfully |
| Shutdown | source and fresh-copy servers unreachable after termination |

The exact tested commit, environment versions, artifact hashes, per-image results,
and request origins are authoritative in [`latest.json`](latest.json). Timing is
machine-specific and intentionally omitted from this summary.

## Portable launcher status

Portable-launcher smoke evidence is tracked separately in
[`portable-launchers.md`](portable-launchers.md). As of 2026-08-30, the Windows
command path passed with the bundled runtime, cache reuse, occupied-port fallback,
and clean shutdown. Windows Explorer double-click and physical Apple Silicon
Finder/browser acceptance remain pending. This partial launcher record does not
replace or relabel the formal browser-inference evidence in `latest.json`.

## Reproduce the evidence

Start from a committed tree with a clean tracked index and worktree. From
`web_demo`, run these commands in this exact order:

```powershell
npm.cmd run test:browser-acceptance
npm.cmd run test:preprocess-parity
npm.cmd run record:acceptance-evidence
```

The order is intentional. Browser acceptance regenerates the parity directory,
which replaces any earlier `browser-results.json`. Running preprocessing parity
second creates a fresh tensor report without removing the separate built-app
acceptance report. The recorder then validates both reports, the generated
reference manifest, the lockfile versions, and the committed ORT integrity
identities before atomically writing the fixed path `latest.json`.

The recorder refuses to write if the tracked tree is dirty, if Git `HEAD`
changes, if either report fails its schema or gates, or if their model,
threshold, browser version, manifest digest, or artifact identities disagree.
It does not launch a browser itself.

## Commit ownership

`latest.json.testedCommit` identifies the exact clean commit exercised by both
browser suites. After recording, commit only the evidence file:

```powershell
git add results/web_demo_acceptance/latest.json
git commit -m "test(web): record offline browser acceptance evidence"
```

That evidence-only commit is expected to have `testedCommit` as its direct
parent. The evidence file deliberately does not try to contain the hash of its
own commit: a Git commit hash depends on the file content, so such a self-hash
would be circular. Verify the relationship after committing with:

```powershell
$report = Get-Content -Encoding UTF8 -Raw results/web_demo_acceptance/latest.json |
  ConvertFrom-Json
git rev-parse HEAD^
$report.testedCommit
git diff --name-only "$($report.testedCommit)..HEAD"
```

The two hashes must match, and the final diff must contain only formal evidence
files. If later source, build, model, or documentation changes require the gates
to be rerun, first commit those changes, then repeat the same three-command
sequence and create a new evidence-only commit.

## Interpretation boundary

The tensor report records 15-image preprocessing bounds, and the built-app
report embeds per-image probabilities, errors, provider selection, offline
request origins, Unicode fresh-copy behavior, failure diagnostics, and launcher
termination checks. The generated manifest is embedded as well, so the formal
record remains self-contained even though raw tensor files stay ignored.

Inference timing is machine-specific and must not be presented as a guarantee
for another judge's computer. This is deployment parity evidence, not a new
accuracy evaluation: it shows that browser preprocessing and FP32 inference stay
within the frozen tolerances and decisions, but it does not measure generalization
on a newly labeled benchmark.
