# Reference-Locked Detector Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the detector surface to match the approved reference image while adding persistent three-image session history, factual About content, correct repository/contact links, upper-right privacy status, and a reversible analysis transition.

**Architecture:** Keep the existing detector controller and inference pipeline unchanged. Move evidence-strip and session-history behavior into focused site modules, let `DetectorScreen` own presentation/history state, and keep route/content work in the existing site layer. Use a two-row application grid so the hero contains the rail and stage while the evidence strip spans the full viewport width.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, CSS animations, local SVG/font assets, browser Canvas for in-memory thumbnails.

**Working constraints:** Execute in `feat/web-demo-visual-design`. Do not commit, push, merge, or modify `feat/web-demo`; the user has authorized implementation but not source-control publication.

---

## File map

- Create `web_demo/src/site/session-history.ts`: capped history reducer and local thumbnail generation.
- Create `web_demo/src/site/DetectorEvidence.tsx`: semantic threshold bar, concise protocol signal, recent-image slots, and technical-note tile.
- Create `web_demo/tests/unit/session-history.test.ts`: history retention and cap behavior.
- Create `web_demo/public/brands/github-mark.svg`: unmodified official GitHub mark obtained from GitHub's brand download.
- Modify `web_demo/src/App.tsx`: reference topology, external links, privacy card, history capture, return transition, and component wiring.
- Modify `web_demo/src/app.css`: exact reference geometry, visual hierarchy, particle treatment, responsive layout, and motion.
- Modify `web_demo/src/site/routes.ts`: About route and legacy Team alias.
- Modify `web_demo/src/site/ProjectViews.tsx`: Technical Notes content and sourced About page.
- Modify `web_demo/tests/unit/scaffold.test.ts`: detector structure, links, privacy placement, evidence semantics, and back control.
- Modify `web_demo/tests/unit/site-routes.test.ts`: About route and Team alias.
- Modify `web_demo/tests/unit/site-content.test.ts`: About and technical-note source boundaries.
- Modify `web_demo/tests/unit/site-style.test.ts`: grid topology, official asset locality, reverse motion, reduced motion, and mobile layout.

### Task 1: Session history contract

**Files:**
- Create: `web_demo/src/site/session-history.ts`
- Create: `web_demo/tests/unit/session-history.test.ts`

- [ ] **Step 1: Write failing history tests**

```ts
import { describe, expect, it } from 'vitest';
import { appendRecentDetection, type RecentDetection } from '../../src/site/session-history';

const item = (id: string): RecentDetection => ({
  id,
  thumbnailUrl: `data:image/jpeg;base64,${id}`,
  fileName: `${id}.png`,
  label: 'AIGC',
  confidence: 0.9,
});

describe('recent detection history', () => {
  it('keeps earlier successful detections when a new result arrives', () => {
    expect(appendRecentDetection([item('one')], item('two')).map(({ id }) => id))
      .toEqual(['two', 'one']);
  });

  it('keeps only the three newest unique detections', () => {
    const history = ['one', 'two', 'three', 'four']
      .reduce<readonly RecentDetection[]>((current, id) => appendRecentDetection(current, item(id)), []);
    expect(history.map(({ id }) => id)).toEqual(['four', 'three', 'two']);
  });

  it('does not duplicate the same completed result', () => {
    expect(appendRecentDetection([item('one')], item('one'))).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm.cmd test -- tests/unit/session-history.test.ts`
Expected: FAIL because `src/site/session-history.ts` does not exist.

- [ ] **Step 3: Implement the capped reducer and thumbnail generator**

Define `RecentDetection`, `appendRecentDetection(history, next)`, and `createRecentThumbnail(file)` in `session-history.ts`. The reducer removes an existing matching id, prepends the result, and slices to three. The thumbnail function decodes the local `File`, draws a contained preview into a 160 × 100 white canvas, returns a JPEG data URL, closes `ImageBitmap` when supported, and never performs network I/O or disk persistence.

```ts
export function appendRecentDetection(
  history: readonly RecentDetection[],
  next: RecentDetection,
): readonly RecentDetection[] {
  return [next, ...history.filter(({ id }) => id !== next.id)].slice(0, 3);
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm.cmd test -- tests/unit/session-history.test.ts`
Expected: 3 tests pass.

### Task 2: Evidence strip semantics

**Files:**
- Create: `web_demo/src/site/DetectorEvidence.tsx`
- Modify: `web_demo/tests/unit/scaffold.test.ts`

- [ ] **Step 1: Write failing evidence assertions**

Add assertions to the ready and success scaffold tests for:

```ts
expect(html).toContain('FROZEN THRESHOLD');
expect(html).toContain('aria-label="Frozen AIGC threshold 0.55657113"');
expect(html).toContain('ROBUSTNESS PROTOCOL');
expect(html).toContain('NJR · 14 FIXED CONDITIONS');
expect(html).not.toContain('MODEL DEVELOPMENT LOG');
expect(html).toContain('class="evidence-strip"');
```

Render `DetectorEvidence` with three `RecentDetection` fixtures and assert all three filenames occur in the HTML.

- [ ] **Step 2: Run scaffold tests and verify RED**

Run: `npm.cmd test -- tests/unit/scaffold.test.ts`
Expected: FAIL because the current trace and development tile do not implement the required semantics.

- [ ] **Step 3: Implement focused evidence components**

Create `ThresholdBar`, `ProtocolSignal`, `RecentImages`, and `DetectorEvidence`. Use a real 0-to-1 horizontal rail with endpoint/midpoint labels, a threshold marker positioned at `55.657113%`, and a separate optional score marker. Keep protocol copy to exactly the heading and `NJR · 14 FIXED CONDITIONS`; render the fine signal as decorative spans with deterministic indices. Render three fixed recent slots, filling them from history and exposing filename, label, and formatted confidence through `title`/accessible text. Keep `READ NOTES →` linked to `#/technology`.

- [ ] **Step 4: Run scaffold tests and verify GREEN**

Run: `npm.cmd test -- tests/unit/scaffold.test.ts`
Expected: focused tests pass.

### Task 3: Routes, About, and technical notes

**Files:**
- Modify: `web_demo/src/site/routes.ts`
- Modify: `web_demo/src/site/ProjectViews.tsx`
- Modify: `web_demo/tests/unit/site-routes.test.ts`
- Modify: `web_demo/tests/unit/site-content.test.ts`

- [ ] **Step 1: Write failing route and content tests**

Change the route table expectation to `['#/about', 'about']`, add `expect(routeFromHash('#/team')).toBe('about')`, and require the About render to include:

```ts
expect(html).toContain('ABOUT');
expect(html).toContain('LingShu Intelligence');
expect(html).toContain('TikTok TechJam 2026');
expect(html).toContain('72-hour');
expect(html).toContain('Build with joy, code for change');
expect(html).toContain('Thank you');
```

Require Technology content to include `BROWSER RUNTIME`, `DATASET & EVALUATION PREPARATION`, `NJR`, `14 FIXED CONDITIONS`, `Internal data & benchmark note`, and language that a no-match audit is not absolute proof.

- [ ] **Step 2: Run route/content tests and verify RED**

Run: `npm.cmd test -- tests/unit/site-routes.test.ts tests/unit/site-content.test.ts`
Expected: FAIL because the app still exposes Team and lacks the sourced About/notes content.

- [ ] **Step 3: Implement route alias and factual content**

Replace the public `team` route with `about`; map `#/team` to `about` before route validation. Rename `TeamView` to `AboutView`. Add concise `WHY WE BUILT IT`, `TEAM`, and `THANKS` sections using only the approved Devpost facts and verified repository contribution domains. Keep member names/profiles explicitly pending. Extend Technology with separate browser-runtime and dataset/evaluation-preparation blocks, internal-source labels, the final NJR/14-condition summary, official-demo isolation, and bounded leakage-audit wording.

- [ ] **Step 4: Run route/content tests and verify GREEN**

Run: `npm.cmd test -- tests/unit/site-routes.test.ts tests/unit/site-content.test.ts`
Expected: focused tests pass.

### Task 4: Rail links, privacy card, persistent history, and return control

**Files:**
- Create: `web_demo/public/brands/github-mark.svg`
- Modify: `web_demo/src/App.tsx`
- Modify: `web_demo/tests/unit/scaffold.test.ts`

- [ ] **Step 1: Add failing scaffold assertions**

Require:

```ts
expect(html).toContain('src="/brands/github-mark.svg"');
expect(html).toContain('href="mailto:zhiyi012@e.ntu.edu.sg"');
expect(html).toContain('CONTACT');
expect(html).toContain('LOCAL PRIVACY');
expect(html).toContain('IN-MEMORY ONLY');
expect(html).not.toContain('class="privacy-note"');
expect(html).toContain('aria-label="Back to detector home"');
```

Update the render helper to accept optional recent-history fixtures so success markup can prove three retained thumbnails are passed into `DetectorEvidence`.

- [ ] **Step 2: Run scaffold tests and verify RED**

Run: `npm.cmd test -- tests/unit/scaffold.test.ts`
Expected: FAIL on the hand-drawn GitHub mark, duplicate repository link, lower privacy overlay, and missing back control.

- [ ] **Step 3: Acquire the official mark without redrawing it**

Download `https://brand.github.com/GitHub_Logos.zip` to a temporary directory, inspect the archive, and copy the official black mark source unchanged into `public/brands/github-mark.svg`. Record its source in the code comment or project notice. Do not link to a remote CDN at runtime.

- [ ] **Step 4: Implement application behavior**

In `DetectorScreen`:

- Own `recentDetections`, `pendingThumbnail`, `recordedResultId`, and a `presentationPhase` of `idle | entering | analysis | returning`.
- Start `createRecentThumbnail(file)` before forwarding a selected file to the detector.
- On success, await the matching thumbnail once, append it with `appendRecentDetection`, and preserve the history across reset/replacement.
- Put a keyboard-accessible back button in the analysis header. Set `returning`, record the current success if needed, wait for the 760 ms reverse transition, then call `reset` and restore `idle`. Guard repeated clicks.
- In reduced-motion mode, use a short/immediate reset path.
- Replace `GitHubIcon` with the official local `<img>`, keep the repository URL on GitHub only, and change the adjacent link to `mailto:zhiyi012@e.ntu.edu.sg` with label `CONTACT`.
- Merge the compact privacy statement into `LocalFieldCard` and remove the lower `.privacy-note` element.
- Render `DetectorEvidence` outside the hero grid so it spans the viewport.

- [ ] **Step 5: Run scaffold and history tests and verify GREEN**

Run: `npm.cmd test -- tests/unit/scaffold.test.ts tests/unit/session-history.test.ts`
Expected: focused tests pass.

### Task 5: Reference-locked layout and motion

**Files:**
- Modify: `web_demo/src/app.css`
- Modify: `web_demo/tests/unit/site-style.test.ts`

- [ ] **Step 1: Write failing style-contract assertions**

Require CSS selectors/properties for a two-row `application-frame`, nested `.hero-grid`, full-width `.evidence-strip`, `.analysis-back`, `.threshold-bar`, `.protocol-signal`, and `@keyframes analysis-return`, `@keyframes particles-reassemble`, plus existing reduced-motion and mobile queries. Assert the old absolute `.privacy-note` rule is absent and no remote asset URL is introduced.

- [ ] **Step 2: Run the style test and verify RED**

Run: `npm.cmd test -- tests/unit/site-style.test.ts`
Expected: FAIL because the existing frame uses a full-height rail/offset evidence strip and lacks reverse-motion styles.

- [ ] **Step 3: Implement the approved spatial thesis**

Rewrite the relevant CSS around these fixed relationships:

```css
.application-frame {
  min-height: 100svh;
  display: grid;
  grid-template-rows: minmax(0, 77svh) minmax(230px, 23svh);
  background: #fff;
}

.hero-grid {
  min-height: 0;
  display: grid;
  grid-template-columns: clamp(168px, 12.2vw, 194px) minmax(0, 1fr);
}

.evidence-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  width: 100%;
}
```

Match the reference title scale/anchors, left-aligned actions, upper-right card, light-grey italic B2-NJR treatment, dense deterministic dissolve field, straight threshold rail, white evidence tiles, and fine protocol waveform. Add a single authored enter/return motion system and disable nonessential movement under reduced motion. At mobile widths, condense the rail, stack analysis, and switch evidence tiles to two columns or one column without overflow.

- [ ] **Step 4: Run style and scaffold tests and verify GREEN**

Run: `npm.cmd test -- tests/unit/site-style.test.ts tests/unit/scaffold.test.ts`
Expected: focused tests pass.

- [ ] **Step 5: Run the Impeccable mechanical layout scan**

Run: `node C:\Users\123\.codex\skills\impeccable\scripts\detect.mjs --json --scope layout web_demo/src/App.tsx web_demo/src/app.css`
Expected: no unexplained layout findings. Fix any in-scope findings, then rerun the focused tests.

### Task 6: Full verification and bounded visual review

**Files:**
- Verify all modified files
- Update generated `web_demo/dist/**` only through the normal build

- [ ] **Step 1: Run all automated checks**

Run from `web_demo`:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

Expected: 0 failed tests, TypeScript exit 0, Vite build exit 0.

- [ ] **Step 2: Run the local server and browser acceptance**

Start the existing local demo server using the project launcher or `npm.cmd run dev -- --port 11404`, then run the existing browser acceptance workflow and one real-image inference. Verify upload, result metadata, replace, back transition, three sequential recent thumbnails, repository/contact destinations, About route, and no network upload.

- [ ] **Step 3: Perform one batched visual inspection**

Capture desktop and mobile screenshots in the same pass. Compare desktop directly with the supplied 1584 × 1024 reference for grid proportions, title scale, action anchors, upper-right status, B2-NJR perspective, evidence-strip width, and particle density. Check mobile for overflow, focus order, card collisions, and readable controls.

- [ ] **Step 4: Fix all observed in-scope defects in one batch**

Write a failing regression test for each behavioral defect before changing production code. Apply CSS-only optical corrections together, rebuild, and perform at most one confirmation screenshot pass.

- [ ] **Step 5: Verify the final diff and report without publishing**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors; only intended visual-branch files are modified. Report the suggested Conventional Commit message `feat(web-demo): match reference detector experience`, but do not commit without explicit authorization.
