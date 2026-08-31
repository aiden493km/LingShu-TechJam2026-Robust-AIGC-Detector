# Online WebDemo delivery acceptance

This directory is reserved for reviewed evidence from a real Vercel Preview or
Production deployment. The online run checks delivery completeness and runtime
consistency: exact model bytes and SHA-256, required security and cache headers,
real download progress, WebGPU plus forced-WASM inference parity, same-origin
request boundaries, reload cache observations, and inference after the browser
context is taken offline.

It is not a new accuracy benchmark. The ten committed demo images are compared
with the frozen probabilities in `results/demo_predictions_cpu.json` using the
existing browser tolerance and decision threshold. The online record therefore
shows that deployment did not change the browser result; it does not measure
generalization on new labeled data.

Online evidence is deliberately separate from
`results/web_demo_acceptance/latest.json`. That existing file covers the local,
portable WebDemo and fresh-copy launcher. Neither record replaces the other.

## Run against a Preview

Start from the exact committed branch to be tested, with a clean Git index and
worktree. From `web_demo`, pass exactly one HTTPS root URL:

```powershell
npm.cmd run test:online-acceptance -- https://your-preview.vercel.app/
```

The runner refuses HTTP, credentials, non-root paths, query strings, fragments,
dirty Git state, or a changing `HEAD`. It uses installed Microsoft Edge through
`playwright-core`; it does not download a browser.

On success, the runner writes a candidate only to the ignored path:

```text
web_demo/.generated-tests/online/latest.json
```

Review that candidate for the tested commit, deployment URL, bounded request
summary, headers, providers, prediction deltas, cache interpretation, and offline
result. Only after human review should it be copied to this directory as
`latest.json` and committed in a separate evidence-only commit. A candidate is
not formal evidence, and this directory intentionally contains no generated
`latest.json` until a real Preview has passed and been reviewed.

## Privacy and evidence boundary

The runner records bounded metadata only. It does not save uploaded image bytes,
previews, arbitrary response bodies, cookies, authorization headers, Blob write
tokens, or URLs containing query/fragment data. External origins, image-bearing
network requests, mutating HTTP methods, browser errors, model identity drift,
provider fallback in the required WebGPU case, or threshold flips fail the run.

Reload data is an observation for that browser context, not a promise that the
model is permanently cached on every judge's device. Browser and network timing
also remain environment-specific and are not performance guarantees.
