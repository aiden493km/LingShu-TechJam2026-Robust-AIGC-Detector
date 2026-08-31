# Team Portraits and About Copy Width Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Complete — source, documentation, distribution, and responsive browser acceptance verified on 2026-08-31.

**Goal:** Add the four approved team portraits to the About roster and widen only the About header summary and `WHY WE BUILT IT` paragraph.

**Architecture:** Extend the existing immutable roster records with local portrait metadata and render semantic lazy-loaded images inside the current square frames. Add one About-only header class so the two requested text measures can widen without changing any other project route, then regenerate the committed Vite distribution.

**Tech Stack:** React 19, TypeScript, Vitest static rendering, CSS, Vite public assets, committed `web_demo/dist`

---

## File structure

- Create `web_demo/public/team/*.png`: exact user-supplied portrait bytes under semantic names.
- Modify `web_demo/src/site/TeamRoster.tsx`: portrait metadata and semantic image markup.
- Modify `web_demo/src/site/ProjectViews.tsx`: About-only header class.
- Modify `web_demo/src/app.css`: portrait fill/stacking and About-only copy measures.
- Modify `web_demo/tests/unit/team-roster.test.ts`: exact member-to-portrait mapping and image attributes.
- Modify `web_demo/tests/unit/site-style.test.ts`: portrait and About-width CSS contracts.
- Modify the live project/design/runbook documents that currently describe empty frames.
- Modify generated `web_demo/dist/**` only through the normal build.

### Task 1: Lock and implement the portrait mapping

**Files:**
- Create: `web_demo/public/team/jingxuan-qian.png`
- Create: `web_demo/public/team/tianshi-bu.png`
- Create: `web_demo/public/team/zhiyi-li.png`
- Create: `web_demo/public/team/mingxuan-chen.png`
- Modify: `web_demo/tests/unit/team-roster.test.ts`
- Modify: `web_demo/src/site/TeamRoster.tsx`

- [x] **Step 1: Replace the empty-frame test with the failing portrait contract**

Add this fixture beside the existing `members` fixture:

```tsx
const portraits = [
  { name: 'Jingxuan Qian', src: '/team/jingxuan-qian.png' },
  { name: 'Tianshi Bu', src: '/team/tianshi-bu.png' },
  { name: 'Zhiyi Li', src: '/team/zhiyi-li.png' },
  { name: 'Mingxuan Chen', src: '/team/mingxuan-chen.png' },
] as const;
```

Replace `keeps all four portrait frames empty and decorative` with:

```tsx
it('maps the four approved portraits to the correct members', () => {
  const html = renderToStaticMarkup(createElement(ProjectView, { route: 'about' }));
  const imagePositions = portraits.map(({ src }) => html.indexOf(`src="${src}"`));

  expect(html.match(/class="team-portrait-frame"/g) ?? []).toHaveLength(4);
  expect(html.match(/class="team-portrait-image"/g) ?? []).toHaveLength(4);
  expect(imagePositions.every((position) => position >= 0)).toBe(true);
  expect(imagePositions).toEqual([...imagePositions].sort((left, right) => left - right));

  for (const portrait of portraits) {
    expect(html).toContain(`src="${portrait.src}"`);
    expect(html).toContain(`alt="${portrait.name} portrait"`);
  }

  expect(html.match(/width="1254"/g) ?? []).toHaveLength(4);
  expect(html.match(/height="1254"/g) ?? []).toHaveLength(4);
  expect(html.match(/loading="lazy"/g) ?? []).toHaveLength(4);
  expect(html.match(/decoding="async"/g) ?? []).toHaveLength(4);
  expect(html).not.toContain('class="team-portrait-frame" aria-hidden="true"');
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run from `web_demo`:

```powershell
npm.cmd test -- tests/unit/team-roster.test.ts
```

Expected: FAIL because the current roster renders no `<img>` elements and still marks the frames decorative.

- [x] **Step 3: Copy the exact approved bytes into semantic public paths**

From the repository root:

```powershell
New-Item -ItemType Directory -Force web_demo\public\team | Out-Null
Copy-Item -LiteralPath 'C:\Users\123\xwechat_files\wxid_wl7mgthvrted52_5705\temp\RWTemp\2026-08\8133a07b313797c5f70367f49e005fd5\a4321f5ce5dc1a1d870886515989490d.png' -Destination web_demo\public\team\jingxuan-qian.png
Copy-Item -LiteralPath 'C:\Users\123\xwechat_files\wxid_wl7mgthvrted52_5705\temp\RWTemp\2026-08\8133a07b313797c5f70367f49e005fd5\e72ebcf7a476a0a5dcdc1e8b536381fd.png' -Destination web_demo\public\team\tianshi-bu.png
Copy-Item -LiteralPath 'C:\Users\123\xwechat_files\wxid_wl7mgthvrted52_5705\temp\RWTemp\2026-08\8133a07b313797c5f70367f49e005fd5\c1b75f381ebb8b2aa5a58a24f848f193.png' -Destination web_demo\public\team\zhiyi-li.png
Copy-Item -LiteralPath 'C:\Users\123\xwechat_files\wxid_wl7mgthvrted52_5705\temp\RWTemp\2026-08\8133a07b313797c5f70367f49e005fd5\e119efe4174d55fdf11f88908b80a2bd.png' -Destination web_demo\public\team\mingxuan-chen.png
```

Verify destination SHA-256 values match the design specification before changing markup.

- [x] **Step 4: Implement the minimal semantic portrait markup**

Extend `TeamMember`:

```tsx
readonly portraitSrc: string;
readonly portraitAlt: string;
```

Add the exact mapped values to the four roster records, then replace the decorative frame with:

```tsx
<div className="team-portrait-frame">
  <img
    className="team-portrait-image"
    src={member.portraitSrc}
    alt={member.portraitAlt}
    width="1254"
    height="1254"
    loading="lazy"
    decoding="async"
  />
</div>
```

- [x] **Step 5: Run the focused test and verify GREEN**

```powershell
npm.cmd test -- tests/unit/team-roster.test.ts
```

Expected: the roster test file passes with all four portraits in roster display order.

### Task 2: Style the portraits and widen the two About text measures

**Files:**
- Modify: `web_demo/tests/unit/site-style.test.ts`
- Modify: `web_demo/src/site/ProjectViews.tsx`
- Modify: `web_demo/src/app.css`

- [x] **Step 1: Write the failing style/layout assertions**

Extend the Signal Roster style test with:

```tsx
expect(css).toMatch(/\.team-portrait-frame\s*\{[^}]*overflow:\s*hidden/s);
expect(css).toMatch(/\.team-portrait-image\s*\{[^}]*display:\s*block[^}]*width:\s*100%[^}]*height:\s*100%[^}]*object-fit:\s*cover/s);
expect(css).toMatch(/\.team-portrait-frame::before,[\s\S]*\.team-portrait-frame::after\s*\{[^}]*z-index:\s*1/s);
expect(css).toMatch(/\.about-header > p:last-child\s*\{[^}]*max-width:\s*64rem/s);
expect(css).toMatch(/\.about-origin p\s*\{[^}]*max-width:\s*72rem/s);
```

Add this assertion to the existing About roster test:

```tsx
expect(html).toContain('class="project-header about-header"');
```

- [x] **Step 2: Run the focused tests and verify RED**

```powershell
npm.cmd test -- tests/unit/site-style.test.ts tests/unit/team-roster.test.ts
```

Expected: FAIL on missing portrait styles, About-only header class, and local width overrides.

- [x] **Step 3: Load the Impeccable craft floor, then implement the minimal UI change**

Extend the existing `ProjectHeader` signature and render:

```tsx
function ProjectHeader({
  title,
  summary,
  className,
}: {
  readonly title: string;
  readonly summary: string;
  readonly className?: string;
}) {
  return (
<header className={`project-header${className ? ` ${className}` : ''}`}>
      <SignalField />
      <p className="project-kicker">LINGSHU / {title}</p>
      <h1>{title}</h1>
      <p>{summary}</p>
    </header>
  );
}
```

Pass `className="about-header"` from `AboutView`.

Update the frame and add the image rule:

```css
.team-portrait-frame {
  overflow: hidden;
}

.team-portrait-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}

.team-portrait-frame::before,
.team-portrait-frame::after {
  z-index: 1;
}

.about-header > p:last-child { max-width: 64rem; }
.about-origin p { max-width: 72rem; }
```

Keep the shared 39rem project-header rule, the shared 58rem About/Thanks rule, and all breakpoints unchanged.

- [x] **Step 4: Run focused and full source checks**

```powershell
npm.cmd test -- tests/unit/site-style.test.ts tests/unit/team-roster.test.ts
npm.cmd test
npm.cmd run typecheck
```

Expected: focused tests, all Vitest files, and TypeScript pass with no diagnostics.

- [x] **Step 5: Commit the source checkpoint**

```powershell
git add web_demo/public/team web_demo/src/site/TeamRoster.tsx web_demo/src/site/ProjectViews.tsx web_demo/src/app.css web_demo/tests/unit/team-roster.test.ts web_demo/tests/unit/site-style.test.ts
git commit -m "feat(about): add approved team portraits"
```

### Task 3: Reconcile the live documentation

**Files:**
- Modify: `README.md`
- Modify: `web_demo/README.md`
- Modify: `PRODUCT.md`
- Modify: `DESIGN.md`
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-08-31-team-roster-design.md`
- Modify: `docs/superpowers/specs/2026-08-31-team-portraits-design.md`

- [x] **Step 1: Replace only the now-obsolete empty-frame boundary**

Record that all four approved portraits are local square PNGs mapped by the portrait specification. Preserve the prohibition on invented replacements, retouching, extra biographies, and unapproved claims. Add the 64rem About-summary and 72rem origin-copy measures to `DESIGN.md`.

- [x] **Step 2: Check documentation consistency and commit**

```powershell
rg -n "empty portrait|remain empty|awaiting approved|approved images are supplied|39rem|64rem|58rem|72rem" README.md web_demo\README.md PRODUCT.md DESIGN.md AGENTS.md docs\superpowers\specs
git diff --check
git add README.md web_demo/README.md PRODUCT.md DESIGN.md AGENTS.md docs/superpowers/specs/2026-08-31-team-roster-design.md docs/superpowers/specs/2026-08-31-team-portraits-design.md
git commit -m "docs(web-demo): finalize team portrait contract"
```

Expected: live documents describe supplied portraits and the two local width overrides; historical supersession notes remain accurate.

### Task 4: Build, inspect, and synchronize delivery

**Files:**
- Modify generated: `web_demo/dist/**`

- [x] **Step 1: Build and verify the committed distribution**

From `web_demo`:

```powershell
npm.cmd run build
```

Verify the four `dist/team/*.png` hashes match their corresponding `public/team/*.png` hashes, then stage `web_demo/dist` and run:

```powershell
npm.cmd run verify:dist
```

Expected: Vite succeeds, all four portrait assets are copied unchanged, and `git diff --exit-code -- dist` passes against the staged artifact.

- [x] **Step 2: Run one bounded browser inspection pass**

Inspect `http://127.0.0.1:4174/#/about` at approximately 1800 × 1125, 1000 × 900, and 390 × 844. Verify:

- the display order maps to Jingxuan, Tianshi, Zhiyi, Mingxuan;
- all four images report natural size 1254 × 1254 and render without distortion;
- red corner ticks remain visible above every image;
- the desktop header summary no longer breaks after `TikTok TechJam` and fits one line at the wide acceptance viewport;
- the origin paragraph uses the wider desktop measure;
- tablet/mobile copy wraps within the viewport with no horizontal overflow; and
- no console warning or failed portrait request appears.

- [x] **Step 3: Run Impeccable's one mechanical scan and final verification**

```powershell
node C:\Users\123\.codex\skills\impeccable\scripts\detect.mjs --json web_demo\src\site\TeamRoster.tsx web_demo\src\site\ProjectViews.tsx web_demo\src\app.css
npm.cmd test
npm.cmd run typecheck
npm.cmd run verify:dist
```

Expected: no unexplained in-scope detector findings; 0 failed tests; TypeScript and deterministic distribution verification pass.

- [x] **Step 4: Commit the synchronized distribution and verify branch state**

```powershell
git add web_demo/dist
git commit -m "build(web-demo): refresh team portrait distribution"
git diff --check main...HEAD
git status --short --branch
```

Expected: the branch is clean, remains separate from the Vercel worktree, and contains no push, merge, or deployment action.
