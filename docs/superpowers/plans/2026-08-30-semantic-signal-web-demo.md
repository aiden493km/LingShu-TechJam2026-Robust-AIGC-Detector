# Semantic Signal WebDemo Implementation Plan

## Status

Completed on 2026-08-30. The reference-locked homepage revision subsequently
refined this direction, and the resulting implementation is recorded in the
current `web_demo/src/`, committed `web_demo/dist/`, `PRODUCT.md`, and `DESIGN.md`.
The unchecked steps below preserve the original execution plan and are not an
active backlog. Its pending-profile step was superseded by the implemented
[2026-08-31 team roster plan](2026-08-31-team-roster.md).

> **Historical execution instructions:** the original work used the Impeccable
> design workflow and TDD. Do not treat the steps below as current branch or
> publication instructions.

**Goal:** Rebuild the offline LingShu browser detector around the approved Semantic Signal Weather v2 composition while preserving the frozen B2-NJR inference workflow and adding directly addressable technical, results, error-analysis, and team views.

**Architecture:** Keep `useDetector()` mounted once at the application root so hash navigation never reloads the 88,123,029-byte model. Separate pure route/presentation helpers from React rendering, render the detector as an idle-to-analysis state transition, and keep evidence views static and evidence-bounded. CSS and deterministic semantic-particle spans reproduce the approved monochrome editorial system without remote runtime assets.

**Tech Stack:** React 19, TypeScript 7, Vite 8, Vitest 4, ONNX Runtime Web, CSS animations, hash routing.

---

### Task 1: Lock the approved design contract

**Files:**
- Create: `.impeccable/briefs/web-demo-src-app-tsx.md`
- Create: `.impeccable/mocks/semantic-signal-weather/landing-v2.png.json`
- Create: `.impeccable/build/state.json` via the Impeccable build-phase tool

- [ ] **Step 1: Record approval beside the comp**

Create a JSON sidecar containing the embedded prompt and approval flag:

```json
{
  "approved": true,
  "promptFile": "landing-v2.prompt.md",
  "approvedComp": "landing-v2.png"
}
```

- [ ] **Step 2: Write the surface brief**

Record Operate mode, the ten-second judge task, hash destinations, the Semantic Signal Weather world, the title-dissolve transition, and the no-network/no-persistence boundaries with `surface-brief.mjs write web_demo/src/App.tsx`.

- [ ] **Step 3: Start the measured comp-led build**

Run:

```powershell
node C:\Users\123\.codex\skills\impeccable\scripts\build-phase.mjs start --comp .impeccable\mocks\semantic-signal-weather\landing-v2.png --breakpoint 1586x992
```

Expected: build state created with the approved comp and the next required phase printed.

### Task 2: Add deterministic hash navigation

**Files:**
- Create: `web_demo/src/site/routes.ts`
- Create: `web_demo/tests/unit/site-routes.test.ts`
- Modify: `web_demo/src/App.tsx`

- [ ] **Step 1: Write the failing route tests**

```ts
import { describe, expect, it } from 'vitest';
import { routeFromHash } from '../../src/site/routes';

describe('site hash routing', () => {
  it('defaults unknown and empty hashes to detector', () => {
    expect(routeFromHash('')).toBe('detector');
    expect(routeFromHash('#/unknown')).toBe('detector');
  });

  it.each([
    ['#/technology', 'technology'],
    ['#/results', 'results'],
    ['#/errors', 'errors'],
    ['#/team', 'team'],
  ] as const)('maps %s to %s', (hash, route) => {
    expect(routeFromHash(hash)).toBe(route);
  });
});
```

- [ ] **Step 2: Run the route test and verify RED**

Run: `npm.cmd test -- tests/unit/site-routes.test.ts`

Expected: FAIL because `src/site/routes.ts` does not exist.

- [ ] **Step 3: Implement the route contract**

```ts
export const SITE_ROUTES = ['detector', 'technology', 'results', 'errors', 'team'] as const;
export type SiteRoute = (typeof SITE_ROUTES)[number];

export function routeFromHash(hash: string): SiteRoute {
  const candidate = hash.replace(/^#\/?/, '').split(/[?#]/, 1)[0];
  return SITE_ROUTES.includes(candidate as SiteRoute) ? (candidate as SiteRoute) : 'detector';
}
```

Keep `useDetector()` in `App`, subscribe once to `hashchange`, and render the selected route inside one persistent shell.

- [ ] **Step 4: Run the route test and verify GREEN**

Run: `npm.cmd test -- tests/unit/site-routes.test.ts`

Expected: PASS.

### Task 3: Build the detector presentation states

**Files:**
- Create: `web_demo/src/site/presentation.ts`
- Create: `web_demo/src/site/SignalField.tsx`
- Create: `web_demo/tests/unit/site-presentation.test.ts`
- Modify: `web_demo/src/App.tsx`

- [ ] **Step 1: Write failing presentation tests**

```ts
import { describe, expect, it } from 'vitest';
import { detectorPresentation } from '../../src/site/presentation';

describe('detector presentation', () => {
  it.each(['booting', 'ready'] as const)('keeps %s in the title state', (phase) => {
    expect(detectorPresentation(phase)).toBe('idle');
  });

  it.each(['validating', 'preprocessing', 'inferring', 'success'] as const)(
    'moves %s into the analysis state',
    (phase) => expect(detectorPresentation(phase)).toBe('analysis'),
  );

  it('formats confidence without hiding frozen precision', () => {
    expect((0.99999966).toFixed(8)).toBe('0.99999966');
  });
});
```

- [ ] **Step 2: Run the presentation test and verify RED**

Run: `npm.cmd test -- tests/unit/site-presentation.test.ts`

Expected: FAIL because `src/site/presentation.ts` does not exist.

- [ ] **Step 3: Implement pure presentation selection**

```ts
import type { DetectorState } from '../detector/machine';

export function detectorPresentation(phase: DetectorState['phase']): 'idle' | 'analysis' {
  return ['validating', 'preprocessing', 'inferring', 'success'].includes(phase)
    ? 'analysis'
    : 'idle';
}
```

Implement an idle hero containing the approved three-line `ROBUST AIGC DETECTOR`, silver receding `B2-NJR`, model/runtime status, upload control, and model-details link. Keep the analysis layer mounted in the same stage and expose the real preview, current phase, result label, eight-decimal confidence, threshold, provider, model identity, reset, fallback, and error recovery.

- [ ] **Step 4: Implement deterministic semantic particles**

Render fixed spans from a stable character string and index-derived CSS variables; do not use random values during render.

```tsx
const SIGNAL = 'B2NJR01AIGC384FP32LOCAL';
export function SignalField() {
  return <span className="signal-field" aria-hidden="true">{Array.from({ length: 96 }, (_, index) => <i key={index} style={{ '--i': index } as React.CSSProperties}>{SIGNAL[index % SIGNAL.length]}</i>)}</span>;
}
```

- [ ] **Step 5: Run presentation and existing tests**

Run: `npm.cmd test -- tests/unit/site-presentation.test.ts && npm.cmd test`

Expected: the targeted test and all existing tests pass.

### Task 4: Add evidence-bounded project views

**Files:**
- Create: `web_demo/src/site/ProjectViews.tsx`
- Create: `web_demo/tests/unit/site-content.test.ts`
- Modify: `web_demo/src/App.tsx`

- [ ] **Step 1: Write failing content-contract tests**

Read `ProjectViews.tsx` and assert it contains the exact frozen threshold, `B2-NJR`, `WebGPU`, `WASM`, all four required evidence figure filenames, and the phrase `Profiles pending team confirmation`. Assert it does not contain `CUDA`, `batch inference`, or a merged `accuracy` claim.

- [ ] **Step 2: Run the content test and verify RED**

Run: `npm.cmd test -- tests/unit/site-content.test.ts`

Expected: FAIL because `ProjectViews.tsx` does not exist.

- [ ] **Step 3: Implement the four hash views**

Use semantic sections and figure captions:

- Technology: EXIF transpose → RGB → 384×384 bicubic → tensor → ImageNet normalization → B2-NJR FP32 → WebGPU/WASM.
- Results: held-out results and external demonstration benchmark in separate labeled figures.
- Error Analysis: conceptual error-analysis figure and boundary note.
- Team: contribution areas only, with names/portraits explicitly pending confirmation.

- [ ] **Step 4: Run the content test and verify GREEN**

Run: `npm.cmd test -- tests/unit/site-content.test.ts`

Expected: PASS.

### Task 5: Translate the approved comp into responsive CSS and motion

**Files:**
- Modify: `web_demo/src/app.css`
- Create: `web_demo/tests/unit/site-style.test.ts`
- Add: `web_demo/public/fonts/anton-latin.woff2`
- Add: `web_demo/public/fonts/OFL-Anton.txt`

- [ ] **Step 1: Write the failing style-contract test**

Assert `app.css` defines `.site-rail`, `.display-title`, `.model-word`, `.signal-field`, `.analysis-workspace`, `@keyframes title-dissolve`, `@media (max-width: 760px)`, and `@media (prefers-reduced-motion: reduce)`; assert it contains no remote `url(http` reference.

- [ ] **Step 2: Run the style test and verify RED**

Run: `npm.cmd test -- tests/unit/site-style.test.ts`

Expected: FAIL because the approved visual-system selectors do not exist.

- [ ] **Step 3: Implement the approved spatial thesis**

Use a 12rem fixed desktop rail, a rule-bound main field, `Anton` for the condensed display mass, system sans for body copy, paper-white/ink/silver tokens, no rounded SaaS cards, and tabular numeric data. Place the upload action in the first reading path and keep evidence tiles below the opening field.

- [ ] **Step 4: Implement one orchestrated transition**

Animate the idle title out through mask/clip/opacity while particles travel right and the analysis workspace resolves into a left-image/right-result grid. Under reduced motion, remove all travel and show the destination immediately.

- [ ] **Step 5: Implement responsive structure**

At 760 px and below, collapse the rail into a horizontally scrollable header, stack preview before result, preserve hash links and focus order, and keep every control at least 44 px high.

- [ ] **Step 6: Run the style test and verify GREEN**

Run: `npm.cmd test -- tests/unit/site-style.test.ts`

Expected: PASS.

### Task 6: Build, inspect, and synchronize the committed judge distribution

**Files:**
- Modify generated: `web_demo/dist/**`
- Create: `.impeccable/review/desktop.png`
- Create: `.impeccable/review/mobile.png`
- Update generated: `.impeccable/build/**`

- [ ] **Step 1: Run automated gates**

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run verify:dist
```

Expected: all commands exit 0; `verify:dist` proves committed `dist` matches source.

- [ ] **Step 2: Run the judge launcher smoke check**

From the repository root run `cmd /d /c web_demo\start-demo.bat --check`.

Expected: integrity and launch prerequisites pass without requiring Node at judge runtime.

- [ ] **Step 3: Capture and inspect desktop and mobile**

Start the built app locally, capture 1440 px desktop and 390 px mobile screenshots, open both, and check reading order, overflow, focus visibility, exact runtime facts, and the approved title/model composition.

- [ ] **Step 4: Run Impeccable mechanical checks once**

Run `detect.mjs --json` against `web_demo/src/App.tsx`, `web_demo/src/site`, and `web_demo/src/app.css`; fix the returned mechanical findings in one batch.

- [ ] **Step 5: Request the required finish review and document the built world**

Provide the approved comp, desktop/mobile screenshots, changed files, evidence constraints, and build-state paths to the Impeccable finish reviewer. Apply its disposition, then run the Impeccable documenter so final `DESIGN.md` describes the built result.

- [ ] **Step 6: Prepare the handoff without committing**

Because commit permission was not granted, leave the verified changes uncommitted and report suggested Conventional Commit checkpoints:

```text
feat(web): add semantic signal detector shell
feat(web): add evidence and team views
style(web): implement semantic signal visual system
build(web): refresh committed demo distribution
```
