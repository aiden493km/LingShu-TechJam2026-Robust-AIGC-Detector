# LingShu Intelligence Team Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the About page's pending team placeholder with an accessible, responsive four-member LingShu Intelligence Signal Roster.

**Architecture:** Add one focused `TeamRoster` component that owns typed static member data and semantic roster markup, then compose it from the existing `AboutView`. Keep presentation in the existing global stylesheet, add no runtime state or remote data flow, and preserve the rest of the About page unchanged.

**Tech Stack:** React 19, TypeScript, Vitest static rendering, CSS Grid, Vite, committed `web_demo/dist` delivery artifact

---

## File structure

- Create `web_demo/src/site/TeamRoster.tsx`: immutable member records and semantic roster rendering.
- Create `web_demo/tests/unit/team-roster.test.ts`: focused content, order, link, and accessibility contract.
- Modify `web_demo/src/site/ProjectViews.tsx`: replace the placeholder team map with `TeamRoster`.
- Modify `web_demo/tests/unit/site-content.test.ts`: remove the obsolete pending-profile expectation and assert roster composition.
- Modify `web_demo/src/app.css`: Signal Roster presentation and 4/2/1 responsive behavior.
- Modify `web_demo/tests/unit/site-style.test.ts`: CSS contract for grid breakpoints, square portrait frames, red corner ticks, and flat cards.
- Modify `web_demo/dist/**`: regenerate the committed offline delivery bundle after source verification.

### Task 1: Add the confirmed semantic roster

**Files:**
- Create: `web_demo/tests/unit/team-roster.test.ts`
- Create: `web_demo/src/site/TeamRoster.tsx`
- Modify: `web_demo/src/site/ProjectViews.tsx:1-12,387-431`
- Modify: `web_demo/tests/unit/site-content.test.ts:20-45`

- [ ] **Step 1: Write the failing roster test**

Create `web_demo/tests/unit/team-roster.test.ts` with the complete approved content contract:

```tsx
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TeamRoster } from '../../src/site/TeamRoster';

const members = [
  {
    name: 'Jingxuan Qian',
    eyebrow: '01 / TEAM LEAD',
    role: 'MODEL TRAINING & ANALYSIS',
    contribution: 'Led model training, fine-tuning, checkpoint selection, and the B2-NJR error-analysis report.',
    label: '@aiden493km →',
    url: 'https://github.com/aiden493km',
  },
  {
    name: 'Tianshi Bu',
    eyebrow: '02 / DATASET',
    role: 'DATASET & PREPROCESSING',
    contribution: 'Prepared the Track5Data training and evaluation sets, 384 px preprocessing, and clean, robust, and ablation data support.',
    label: '@Tianshi-Bu →',
    url: 'https://github.com/Tianshi-Bu',
  },
  {
    name: 'Zhiyi Li',
    eyebrow: '03 / WEB DELIVERY',
    role: 'FULL-STACK WEB DELIVERY',
    contribution: 'Built the end-to-end WebDemo and dual delivery stack: FP32 model conversion, WebGPU/WASM inference, product UI, offline packaging, Vercel deployment, Blob-backed model delivery, integrity verification, and acceptance testing.',
    label: '@Awes0meE →',
    url: 'https://github.com/Awes0meE',
  },
  {
    name: 'Mingxuan Chen',
    eyebrow: '04 / COMMUNICATIONS',
    role: 'VIDEO & COMMUNICATIONS',
    contribution: 'Leads video editing, promotional storytelling, and submission media for the project.',
    label: '@CharlieC007 →',
    url: 'https://github.com/CharlieC007',
  },
] as const;

describe('LingShu Intelligence team roster', () => {
  it('renders four confirmed members in the approved order', () => {
    const html = renderToStaticMarkup(createElement(TeamRoster));
    const positions = members.map(({ name }) => html.indexOf(name));

    expect(html.match(/class="team-profile"/g) ?? []).toHaveLength(4);
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(html.match(/01 \/ TEAM LEAD/g) ?? []).toHaveLength(1);
  });

  it('exposes the exact roles, contributions, and GitHub destinations', () => {
    const html = renderToStaticMarkup(createElement(TeamRoster));

    for (const member of members) {
      expect(html).toContain(member.eyebrow);
      expect(html).toContain(member.role.replaceAll('&', '&amp;'));
      expect(html).toContain(member.contribution);
      expect(html).toContain(`href="${member.url}"`);
      expect(html).toContain(`aria-label="Visit ${member.name} on GitHub"`);
      expect(html).toContain(member.label);
    }

    expect(html.match(/target="_blank"/g) ?? []).toHaveLength(4);
    expect(html.match(/rel="noreferrer"/g) ?? []).toHaveLength(4);
  });

  it('keeps all four portrait frames empty and decorative', () => {
    const html = renderToStaticMarkup(createElement(TeamRoster));

    expect(html.match(/class="team-portrait-frame"/g) ?? []).toHaveLength(4);
    expect(html.match(/aria-hidden="true"/g) ?? []).toHaveLength(4);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('coming soon');
  });
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run from `web_demo`:

```powershell
npm.cmd test -- tests/unit/team-roster.test.ts
```

Expected: FAIL because `src/site/TeamRoster.tsx` does not exist.

- [ ] **Step 3: Implement the typed roster component**

Create `web_demo/src/site/TeamRoster.tsx`:

```tsx
interface TeamMember {
  readonly eyebrow: string;
  readonly name: string;
  readonly role: string;
  readonly contribution: string;
  readonly githubLabel: string;
  readonly githubUrl: string;
}

const TEAM_MEMBERS = [
  {
    eyebrow: '01 / TEAM LEAD',
    name: 'Jingxuan Qian',
    role: 'MODEL TRAINING & ANALYSIS',
    contribution: 'Led model training, fine-tuning, checkpoint selection, and the B2-NJR error-analysis report.',
    githubLabel: '@aiden493km →',
    githubUrl: 'https://github.com/aiden493km',
  },
  {
    eyebrow: '02 / DATASET',
    name: 'Tianshi Bu',
    role: 'DATASET & PREPROCESSING',
    contribution: 'Prepared the Track5Data training and evaluation sets, 384 px preprocessing, and clean, robust, and ablation data support.',
    githubLabel: '@Tianshi-Bu →',
    githubUrl: 'https://github.com/Tianshi-Bu',
  },
  {
    eyebrow: '03 / WEB DELIVERY',
    name: 'Zhiyi Li',
    role: 'FULL-STACK WEB DELIVERY',
    contribution: 'Built the end-to-end WebDemo and dual delivery stack: FP32 model conversion, WebGPU/WASM inference, product UI, offline packaging, Vercel deployment, Blob-backed model delivery, integrity verification, and acceptance testing.',
    githubLabel: '@Awes0meE →',
    githubUrl: 'https://github.com/Awes0meE',
  },
  {
    eyebrow: '04 / COMMUNICATIONS',
    name: 'Mingxuan Chen',
    role: 'VIDEO & COMMUNICATIONS',
    contribution: 'Leads video editing, promotional storytelling, and submission media for the project.',
    githubLabel: '@CharlieC007 →',
    githubUrl: 'https://github.com/CharlieC007',
  },
] as const satisfies readonly TeamMember[];

export function TeamRoster() {
  return (
    <ol className="team-roster-grid" aria-label="LingShu Intelligence team">
      {TEAM_MEMBERS.map((member) => (
        <li className="team-profile" key={member.name}>
          <div className="team-portrait-frame" aria-hidden="true" />
          <p className="team-profile-eyebrow">{member.eyebrow}</p>
          <h3 className="team-profile-name">{member.name}</h3>
          <p className="team-profile-role">{member.role}</p>
          <p className="team-profile-contribution">{member.contribution}</p>
          <a
            className="team-profile-github"
            href={member.githubUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Visit ${member.name} on GitHub`}
          >
            {member.githubLabel}
          </a>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 4: Compose the roster into AboutView and remove pending content**

Add the focused import beside the existing site components in `web_demo/src/site/ProjectViews.tsx`:

```tsx
import { SignalField } from './SignalField';
import { TeamRoster } from './TeamRoster';
import type { SiteRoute } from './routes';
```

Replace `AboutView` with:

```tsx
function AboutView() {
  return (
    <>
      <ProjectHeader
        title="ABOUT"
        summary="Why LingShu Intelligence built a local, inspectable AIGC detector for TikTok TechJam 2026."
      />
      <section className="project-section about-origin">
        <h2>WHY WE BUILT IT</h2>
        <p>
          TikTok TechJam 2026 is a 72-hour student hackathon built around five challenges and the
          theme “Build with joy, code for change.” LingShu responds to the robust AIGC-detection
          challenge with one-image browser inference that judges can run, understand, and inspect
          without sending the image to a server.
        </p>
        <a href="https://tiktoktechjam2026.devpost.com/" target="_blank" rel="noreferrer">
          OFFICIAL EVENT PAGE →
        </a>
      </section>
      <section className="project-section team-section">
        <header className="team-intro">
          <h2>TEAM — LINGSHU INTELLIGENCE</h2>
        </header>
        <TeamRoster />
      </section>
      <section className="project-section about-thanks">
        <h2>THANKS</h2>
        <p>
          Thank you to TikTok, the TechJam organisers, workshop engineers, judges, and supporting
          teams for creating a focused environment for learning, building, and testing ideas.
          This acknowledgement does not imply endorsement of this project.
        </p>
      </section>
    </>
  );
}
```

In `web_demo/tests/unit/site-content.test.ts`, replace the obsolete assertion:

```tsx
expect(source).toContain('Profiles pending team confirmation');
```

with:

```tsx
expect(source).toContain('<TeamRoster />');
expect(source).not.toContain('Profiles pending team confirmation');
expect(source).not.toContain('The contribution map records verified work areas');
```

- [ ] **Step 5: Run the focused content tests and verify the green state**

Run from `web_demo`:

```powershell
npm.cmd test -- tests/unit/team-roster.test.ts tests/unit/site-content.test.ts
```

Expected: both test files PASS; the About static render retains the event and acknowledgement copy.

- [ ] **Step 6: Commit the semantic roster checkpoint**

```powershell
git add web_demo/src/site/TeamRoster.tsx web_demo/src/site/ProjectViews.tsx web_demo/tests/unit/team-roster.test.ts web_demo/tests/unit/site-content.test.ts
git commit -m "feat(about): add LingShu team roster"
```

### Task 2: Implement and lock the Signal Roster styling

**Files:**
- Modify: `web_demo/tests/unit/site-style.test.ts`
- Modify: `web_demo/src/app.css:935-948,996-1003,1071-1086,1092-1100`

- [ ] **Step 1: Write the failing responsive-style test**

Add this test inside the existing `describe` block in `web_demo/tests/unit/site-style.test.ts`:

```tsx
it('defines the flat square Signal Roster at four, two, and one columns', async () => {
  const css = await readFile(new URL('../../src/app.css', import.meta.url), 'utf8');
  const tabletCss = css.match(
    /@media \(max-width: 1020px\)\s*\{([\s\S]*?)\r?\n\}\r?\n\r?\n@media \(max-width: 760px\)/,
  )?.[1] ?? '';
  const mobileCss = css.match(
    /@media \(max-width: 760px\)\s*\{([\s\S]*?)\r?\n\}\r?\n\r?\n@media \(max-width: 430px\)/,
  )?.[1] ?? '';
  const profileRule = css.match(/\.team-profile\s*\{([^}]*)\}/s)?.[1] ?? '';

  expect(css).toMatch(/\.team-section\s*\{[^}]*--team-signal-red:\s*#b5122b/s);
  expect(css).toMatch(/\.team-roster-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s);
  expect(css).toMatch(/\.team-portrait-frame\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1[^}]*border:\s*1px solid var\(--ink\)/s);
  expect(css).toMatch(/\.team-portrait-frame::before[\s\S]*border-top:\s*2px solid var\(--team-signal-red\)/s);
  expect(css).toMatch(/\.team-portrait-frame::after[\s\S]*border-bottom:\s*2px solid var\(--team-signal-red\)/s);
  expect(tabletCss).toMatch(/\.team-roster-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  expect(mobileCss).toMatch(/\.team-roster-grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
  expect(profileRule).not.toContain('border-radius');
  expect(profileRule).not.toContain('box-shadow');
});
```

- [ ] **Step 2: Run the style test and verify the red state**

Run from `web_demo`:

```powershell
npm.cmd test -- tests/unit/site-style.test.ts
```

Expected: FAIL because the `team-roster-grid`, `team-profile`, portrait-frame, and signal-red contracts do not exist.

- [ ] **Step 3: Replace the old contribution-grid styles**

Replace the existing `.team-intro`, `.team-pending`, and `.contribution-grid` rules with:

```css
.team-section { --team-signal-red: #b5122b; padding: 0; }
.team-intro { width: 100%; padding: clamp(2.5rem, 5vw, 5.5rem); border-bottom: var(--hairline); }
.team-intro h2 { margin: 0; }
.team-roster-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
}
.team-profile {
  display: flex;
  min-width: 0;
  min-height: 31rem;
  padding: clamp(1.25rem, 2.1vw, 2rem);
  flex-direction: column;
  border-right: var(--hairline);
  text-align: center;
}
.team-profile:last-child { border-right: 0; }
.team-portrait-frame {
  position: relative;
  width: min(100%, 12.5rem);
  aspect-ratio: 1 / 1;
  margin: 0 auto 1.6rem;
  border: 1px solid var(--ink);
  background: var(--paper);
}
.team-portrait-frame::before,
.team-portrait-frame::after {
  position: absolute;
  width: 1.1rem;
  height: 1.1rem;
  content: '';
  pointer-events: none;
}
.team-portrait-frame::before {
  top: -1px;
  left: -1px;
  border-top: 2px solid var(--team-signal-red);
  border-left: 2px solid var(--team-signal-red);
}
.team-portrait-frame::after {
  right: -1px;
  bottom: -1px;
  border-right: 2px solid var(--team-signal-red);
  border-bottom: 2px solid var(--team-signal-red);
}
.team-profile-eyebrow {
  margin: 0 0 0.55rem;
  color: var(--mid);
  font-size: 0.58rem;
  font-weight: 800;
  letter-spacing: 0.14em;
}
.team-profile:first-child .team-profile-eyebrow { color: var(--team-signal-red); }
.team-profile-name {
  margin: 0;
  font-family: 'League Gothic', Impact, sans-serif;
  font-size: clamp(2.35rem, 3.2vw, 3.4rem);
  font-weight: 400;
  letter-spacing: 0.02em;
  line-height: 0.95;
  text-transform: uppercase;
}
.team-profile-role {
  min-height: 2.5em;
  margin: 0.85rem 0 0;
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  line-height: 1.3;
}
.team-profile-contribution {
  margin: 1rem 0 0;
  color: var(--mid);
  font-size: 0.74rem;
  line-height: 1.65;
}
.team-profile-github {
  margin-top: auto;
  padding-top: 1.5rem;
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-underline-offset: 0.3em;
}
```

Add the two-column tablet state to the `@media (max-width: 1020px)` block:

```css
  .team-roster-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .team-profile { min-height: 29rem; border-bottom: var(--hairline); }
  .team-profile:nth-child(2n) { border-right: 0; }
  .team-profile:nth-last-child(-n + 2) { border-bottom: 0; }
```

In the `@media (max-width: 760px)` block:

1. Remove `.team-intro` from the selector that converts two-column content layouts to one column.
2. Replace the old `.contribution-grid` rules with:

```css
  .team-section { padding: 0; }
  .team-intro { padding: 2.3rem 1.3rem; }
  .team-roster-grid { grid-template-columns: 1fr; }
  .team-profile,
  .team-profile:nth-child(2n),
  .team-profile:nth-last-child(-n + 2) {
    min-height: 0;
    border-right: 0;
    border-bottom: var(--hairline);
  }
  .team-profile:last-child { border-bottom: 0; }
```

In the `@media (max-width: 430px)` block, remove `.contribution-grid` and its article selectors from the two existing combined rules. Leave the evidence-only rules as:

```css
  .evidence-strip { grid-template-columns: 1fr; }
  .evidence-block, .evidence-block:nth-child(2) { border-right: 0; }
```

- [ ] **Step 4: Run the style and content tests**

Run from `web_demo`:

```powershell
npm.cmd test -- tests/unit/site-style.test.ts tests/unit/team-roster.test.ts tests/unit/site-content.test.ts
```

Expected: all three test files PASS. Existing global focus styles continue to cover the GitHub links.

- [ ] **Step 5: Commit the responsive visual checkpoint**

```powershell
git add web_demo/src/app.css web_demo/tests/unit/site-style.test.ts
git commit -m "style(about): add responsive signal roster"
```

### Task 3: Synchronize the committed delivery bundle

**Files:**
- Modify: `web_demo/dist/**`

- [ ] **Step 1: Run the full source test suite**

Run from `web_demo`:

```powershell
npm.cmd test
```

Expected: all Vitest suites PASS with no unhandled errors.

- [ ] **Step 2: Run TypeScript validation**

```powershell
npm.cmd run typecheck
```

Expected: PASS with exit code 0 and no TypeScript diagnostics.

- [ ] **Step 3: Regenerate the static distribution**

```powershell
npm.cmd run build
```

Expected: Vite completes successfully, `dist/index.html` is regenerated, and changed hashed assets appear under `dist/assets`.

- [ ] **Step 4: Stage only the regenerated delivery artifact and verify reproducibility**

Run from the repository root:

```powershell
git add -- web_demo/dist
```

Then run from `web_demo`:

```powershell
npm.cmd run verify:dist
```

Expected: the build completes and `git diff --exit-code -- dist` returns exit code 0 because the working distribution exactly matches the staged artifact.

- [ ] **Step 5: Commit the synchronized bundle**

Run from the repository root:

```powershell
git commit -m "build(web-demo): refresh team roster distribution"
```

Expected: the commit contains only regenerated `web_demo/dist` changes.

### Task 4: Perform responsive and keyboard browser acceptance

**Files:**
- Verify only: `web_demo/src/site/TeamRoster.tsx`
- Verify only: `web_demo/src/site/ProjectViews.tsx`
- Verify only: `web_demo/src/app.css`

- [ ] **Step 1: Start the local WebDemo**

Run from `web_demo` and keep the process active:

```powershell
npm.cmd run dev -- --port 4174
```

Expected: Vite reports `http://127.0.0.1:4174/` and no startup error.

- [ ] **Step 2: Inspect the About page at desktop width**

Open `http://127.0.0.1:4174/#/about` at approximately 1440 × 900.

Expected: four equal cards appear in one row; every empty portrait frame is square; all names, roles, contributions, and handles are visible; Jingxuan's lead eyebrow is restrained; `WHY WE BUILT IT` and `THANKS` are unchanged; there is no horizontal overflow.

- [ ] **Step 3: Inspect tablet and mobile layouts**

Inspect the same route at approximately 900 × 900 and 390 × 844.

Expected at 900 px: two equal columns with clean internal hairlines.

Expected at 390 px: one column, no doubled right borders, no clipped copy, and all four GitHub links remain visible.

- [ ] **Step 4: Verify keyboard and external-link behavior**

Starting before the roster, use Tab to visit all four GitHub links and activate one test link.

Expected: every handle receives a visible focus outline, has the correct member-specific accessible name, and opens the approved GitHub profile in a new tab. No profile information depends on hover.

- [ ] **Step 5: Confirm final repository state**

Run from the repository root:

```powershell
git status --short --branch
git log -4 --oneline --decorate
```

Expected: no source, test, or `dist` changes remain. The pre-existing untracked `.superpowers/` visual-companion directory may remain and must not be committed. The recent history contains the design, plan, semantic roster, responsive style, and distribution checkpoints in Conventional Commits format.
