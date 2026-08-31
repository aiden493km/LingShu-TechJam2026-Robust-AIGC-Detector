# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is a TikTok TechJam judge opening the self-contained local WebDemo on a desktop computer. Their first job is to select one still image, understand whether the frozen detector classifies it as Real or AIGC, and see enough runtime context to trust that the result came from the disclosed local model.

Secondary visitors evaluate the project's technical route, verified results, error analysis, and team contribution after the detector task is clear.

## Product Purpose

The product demonstrates the frozen B2-NJR robust AIGC detector wholly inside the browser while explaining the engineering and evidence behind it. The first priority is that a judge can identify the image action immediately and can submit one image and understand the resulting decision in roughly ten seconds, subject to the local model becoming ready. Project storytelling is secondary and must not delay or obscure that task.

## Positioning

The same disclosed FP32 B2-NJR model runs locally through WebGPU or the WASM compatibility fallback, with one frozen threshold and no image upload. The interface pairs an auditable inference workflow with clearly separated technical, evaluation, and error-analysis evidence rather than presenting an unexplained score.

## Operating Context

- Judges launch the committed offline distribution from the repository and use it without installing a frontend toolchain or connecting to a remote inference service.
- The initial interaction is a single-image workflow with explicit model loading, validation, preprocessing, inference, success, fallback, and error states.
- The same site also carries the technical route, verified result figures, error analysis, and team information. A persistent top-level navigation should make those destinations directly reachable while keeping Detector as the default entry.
- The primary interface language is English. Desktop judging is the priority; the complete content must remain readable and operable on mobile.

## Capabilities and Constraints

- Preserve the existing React and TypeScript detector state machine and its functional behavior.
- Accept one JPEG, PNG, or WebP still image up to 25 MiB.
- Keep selected image bytes in browser memory. Do not add uploads, persistence, analytics, remote fonts, remote assets, or non-loopback serving.
- Deploy only `web_demo/models/baseline2_njr_fp32.onnx`; WebGPU and WASM must use that same model and frozen threshold `0.55657113`.
- Keep the committed `web_demo/dist/` synchronized with `web_demo/src/`; judges run the committed build.
- Do not imply CUDA, batch inference, server inference, alternate deployed models, or public-release clearance that the repository does not support.
- Detector, Technology, Results, Error Analysis, and About are the implemented information destinations. About contains the bounded team and TechJam context; Detector remains the no-friction default.

## Brand Commitments

- Product name: LingShu Robust AIGC Detector.
- Model name: B2-NJR.
- Voice: concise, technically literate, evidence-bounded, and understandable to a judge without requiring repository archaeology.
- Existing project figures and team materials may be reused only where their labels and claims match the verified source evidence.

## Evidence on Hand

- `results/web_demo_acceptance/latest.json`: recorded offline browser, model identity, WebGPU/WASM, and preprocessing evidence for its named tested commit.
- `assets/figures/final_heldout_results.png`: held-out evaluation figure.
- `assets/figures/external_benchmark.png`: external demonstration benchmark figure; it is not a final competition score.
- `assets/figures/ablation_summary.png`, `assets/figures/pipeline_overview.png`, and `assets/figures/transformation_examples.png`: technical-route material.
- `assets/figures/error_analysis_concept.png`: error-analysis material whose wording must remain consistent with its actual evidence status.
- `assets/figures/web_demo_preview.png`: presentation mockup only, not runtime truth; it contains concepts such as CUDA and batch size that must not be copied into the real interface.
- The About roster uses the user-confirmed four-member names, contribution copy, and GitHub profiles recorded in `docs/superpowers/specs/2026-08-31-team-roster-design.md`, plus the four exact user-supplied portraits mapped in `docs/superpowers/specs/2026-08-31-team-portraits-design.md`. Do not replace or retouch those images or invent portraits or additional biographical details.

Internal held-out robustness results, the external demonstration benchmark, browser deployment parity, and historical model-compression experiments are separate evidence sets and must not be merged into one accuracy claim.

## Product Principles

- Task before story: the detector action and result dominate the entry experience.
- Trust through specifics: expose the real model, threshold, provider, privacy boundary, and meaningful processing state without overwhelming the first task.
- Evidence stays separated: every metric and figure keeps its source, scope, and limitations.
- One product, multiple depths: navigation supports technical exploration without turning the initial detector into a marketing obstacle.
- Offline behavior is product behavior: visual ambition must not introduce network, packaging, or runtime dependencies.

## Accessibility & Inclusion

- Provide keyboard-operable navigation, upload, retry, reset, and disclosure controls with visible focus treatment.
- Preserve semantic headings, status announcements, progress information, and error messages for assistive technology.
- Respect reduced-motion preferences and avoid motion that delays the detector task.
- Maintain readable contrast and layouts from desktop judging widths down to a 320 px mobile viewport.
