# LingShu Intelligence Team Roster Design

**Date:** 2026-08-31

**Status:** Implemented and verified on `feat/about-page-refresh`; portrait state superseded by `2026-08-31-team-portraits-design.md`

**Scope:** Replace the placeholder team contribution map on `#/about` with four confirmed member profiles

**Content authority:** The user-supplied roster and GitHub URLs are authoritative. The internal progress report corroborates the model, dataset, evaluation, and WebDemo work areas.

## 1. Goal

The `TEAM — LINGSHU INTELLIGENCE` section must identify all four confirmed members, explain each person's contribution accurately, and link each profile to the correct GitHub account. It should retain the site's existing editorial, black-and-white visual language while adapting the supplied four-person reference into the project's square, signal-oriented design system.

The change replaces only the current pending-profile copy and abstract contribution grid. The existing `WHY WE BUILT IT` and `THANKS` sections remain unchanged.

## 2. Approved layout

Use the approved **Signal Roster** approach:

- Four equal profile cards appear in one row on wide desktop layouts.
- Every card contains, in order, a square portrait frame, a compact numbered eyebrow, the member's name, a role heading, a short contribution paragraph, and a visible GitHub handle link.
- Each frame contains the exact approved user-supplied portrait mapped in `2026-08-31-team-portraits-design.md`. A thin black square outline and short red corner ticks at the upper-left and lower-right preserve the original Signal Roster treatment; no stock, generated, retouched, or inferred replacement is allowed.
- Jingxuan Qian's card is identified by the subtle eyebrow `01 / TEAM LEAD`. It is not enlarged, inverted, or otherwise promoted above the other members.
- The other eyebrows are `02 / DATASET`, `03 / WEB DELIVERY`, and `04 / COMMUNICATIONS`.
- The section retains the existing white paper background, black text, thin grey hairlines, square geometry, and small red signal accents.
- No rounded cards, circular portrait masks, gradients, drop shadows, floating panels, or roster animation are introduced.

The supplied reference controls the four-person rhythm and information hierarchy, not its circular portraits or generic corporate styling.

## 3. Final roster content

The roster order and visible English copy are fixed as follows.

### 01 — Jingxuan Qian

- Eyebrow: `01 / TEAM LEAD`
- Role: `MODEL TRAINING & ANALYSIS`
- Contribution: `Led model training, fine-tuning, checkpoint selection, and the B2-NJR error-analysis report.`
- GitHub label: `@aiden493km →`
- GitHub URL: `https://github.com/aiden493km`

### 02 — Tianshi Bu

- Eyebrow: `02 / DATASET`
- Role: `DATASET & PREPROCESSING`
- Contribution: `Prepared the Track5Data training and evaluation sets, 384 px preprocessing, and clean, robust, and ablation data support.`
- GitHub label: `@Tianshi-Bu →`
- GitHub URL: `https://github.com/Tianshi-Bu`

### 03 — Zhiyi Li

- Eyebrow: `03 / WEB DELIVERY`
- Role: `FULL-STACK WEB DELIVERY`
- Contribution: `Built the end-to-end WebDemo and dual delivery stack: FP32 model conversion, WebGPU/WASM inference, product UI, offline packaging, Vercel deployment preparation, model-delivery integrity verification, and acceptance testing.`
- GitHub label: `@Awes0meE →`
- GitHub URL: `https://github.com/Awes0meE`

`FULL-STACK WEB DELIVERY` is deliberate. It communicates ownership across model integration, browser runtime, interface, packaging, hosting preparation, and delivery tooling without claiming a completed public deployment, conventional application backend, remote inference API, database, or server function.

### 04 — Mingxuan Chen

- Eyebrow: `04 / COMMUNICATIONS`
- Role: `VIDEO & COMMUNICATIONS`
- Contribution: `Leads video editing, promotional storytelling, and submission media for the project.`
- GitHub label: `@CharlieC007 →`
- GitHub URL: `https://github.com/CharlieC007`

## 4. Component and data design

Create a focused `TeamRoster` component in `web_demo/src/site/TeamRoster.tsx`. The file owns:

- a typed, immutable four-member roster;
- rendering of the ordered profile list; and
- the profile-card markup.

Each roster record contains only the fields required by the approved design: member number, eyebrow, name, role, contribution, GitHub label, GitHub URL, and the approved local portrait source and alternative text. No remote fetch, content-management layer, or runtime state is added. The first member's approved eyebrow supplies the only team-lead distinction.

`AboutView` in `web_demo/src/site/ProjectViews.tsx` keeps responsibility for the surrounding About-page sections. It removes the local `domains` array, pending-profile message, and abstract contribution map, then renders `TeamRoster` under the existing `TEAM — LINGSHU INTELLIGENCE` heading.

The roster is an ordered semantic list so member order is explicit. Each member is one list item containing an article-like profile. Every portrait is meaningful content and uses the approved `<member name> portrait` alternative text; its enclosing frame is not hidden from assistive technology.

## 5. Links and interaction

Every GitHub link:

- displays the exact approved `@handle →` label;
- opens the exact profile URL in a new tab;
- uses `rel="noreferrer"`;
- provides an accessible name in the form `Visit <member name> on GitHub`; and
- receives the site's visible keyboard-focus treatment.

The roster has no JavaScript interaction, hover-only information, carousel behavior, or client-side error state. If GitHub is unavailable, normal browser behavior applies; the page does not substitute or silently redirect a profile URL.

## 6. Responsive behavior

The profile grid uses these fixed layout states:

- wide desktop: four equal columns;
- tablet and narrow desktop: two equal columns;
- mobile: one column.

Hairlines must resolve cleanly at every breakpoint without doubled internal borders. Names, roles, and contribution copy must wrap inside their card without horizontal overflow. The longer Zhiyi Li contribution may occupy more lines, but all four cards retain a common visual structure rather than truncating content or hiding it behind disclosure controls.

The square portrait frame preserves a `1 / 1` aspect ratio at every breakpoint. Mobile spacing may tighten, but the portrait, name, role, contribution, and GitHub link must remain visible without interaction.

## 7. Accessibility and content boundaries

- The section keeps the visible heading `TEAM — LINGSHU INTELLIGENCE`.
- The ordered roster has an accessible label identifying it as the LingShu Intelligence team.
- Every portrait exposes the approved member-specific alternative text and is not `aria-hidden`.
- Names and roles remain text, not text embedded in images.
- External links remain reachable and visibly focused by keyboard.
- All public-facing roster copy remains English, matching the rest of the site.

The page must not invent portraits, biographies, education history, job titles, personal contact details, social accounts, or additional contribution claims. Team member information comes only from the approved roster in this specification.

## 8. Testing strategy

Implementation follows test-driven development. First update the About-page static-render test so it fails against the current placeholder implementation. The test must verify:

1. Exactly four member cards render in the approved order.
2. All four names and exact role headings are present.
3. Each approved contribution sentence is present.
4. Every visible GitHub handle points to the exact approved URL.
5. All four GitHub links use a new tab, `noreferrer`, and a member-specific accessible name.
6. `01 / TEAM LEAD` appears only for Jingxuan Qian.
7. `Profiles pending team confirmation` and the unassigned contribution-map explanation are absent.
8. The existing event background and non-endorsement acknowledgement remain present.

Focused style assertions should confirm the four-column base grid, two-column intermediate breakpoint, one-column mobile breakpoint, square portrait frames, and absence of rounded profile-card styling. These source-level assertions complement rather than replace browser inspection.

After the focused test passes, run from `web_demo`:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run verify:dist
```

Because `verify:dist` treats the committed static bundle as a delivery artifact, the regenerated `web_demo/dist` output must be included and synchronized with the source change.

## 9. Visual acceptance

Open `#/about` through the local site and inspect at representative desktop, tablet, and mobile widths. Acceptance requires:

- four, two, and one-column layouts at the intended widths;
- no horizontal scrolling or clipped text;
- square, correctly mapped portraits with consistent proportions and visible red corner ticks;
- readable hierarchy from eyebrow to name, role, contribution, and GitHub link;
- restrained distinction for the team lead without a featured-card treatment;
- visible mouse and keyboard link states;
- unchanged `WHY WE BUILT IT` and `THANKS` sections; and
- visual continuity with the existing About page and broader LingShu interface.

## 10. Scope exclusions

This task does not:

- generate, retouch, crop, recompress, or replace the approved member portraits;
- change detector inference, model loading, preprocessing, or result handling;
- add a backend, remote inference endpoint, database, analytics, or contact form;
- merge or modify the separate Vercel online-deployment branch;
- change the existing event or acknowledgement copy; or
- redesign other project routes.

The implementation is complete only when the source, tests, committed distribution bundle, and responsive browser presentation all agree with this specification.
