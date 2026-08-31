# Reference-Locked Detector Homepage Revision

**Date:** 2026-08-30
**Status:** Implemented and user-approved
**Scope:** Detector homepage and its in-session analysis transition
**Visual authority:** User-supplied 1584 × 1024 reference; its durable implementation contract is captured in this specification.

> [!NOTE]
> The pending-member boundary in section 7 was superseded on 2026-08-31 by the
> [confirmed team roster design](2026-08-31-team-roster-design.md). The four
> approved profiles are now implemented; portrait frames remain intentionally
> empty, and the original no-invention rule still applies beyond that roster.

## 1. Design contract

The supplied 1584 × 1024 reference image is the visual source of truth. The implementation must reproduce its white background, thin grey rules, two-row grid, proportions, typography scale, particle graphics, control placement, and restrained black/grey palette. Existing visual ideas must not override the reference.

There is one approved content-level divergence: the second tile in the bottom strip becomes **ROBUSTNESS PROTOCOL**. It keeps the reference tile's white background, border treatment, spacing, and fine black particle-wave graphic. It must not become a dark/inverted card.

The site remains entirely in English.

The following interaction and content updates are also approved without changing the reference composition: Recent Images becomes a three-item in-memory history, the GitHub link uses an official GitHub mark, the second rail link becomes email contact, the privacy note moves into the upper-right status card, and the final navigation destination becomes About.

## 2. Page geometry

### Desktop composition

The viewport is divided into two rows:

1. A hero row occupying approximately the upper 77% of the viewport.
2. A four-tile evidence strip occupying approximately the lower 23%.

The hero row is divided into:

- A left navigation rail approximately 12.2% of viewport width.
- A main stage occupying the remaining width.

The evidence strip is a sibling of the hero row and spans the complete viewport width. It contains four equal-width tiles beginning at the left edge of the viewport. The left rail ends exactly at the evidence-strip boundary; it must not continue behind or through the bottom tiles.

The implementation should express this topology directly as a two-row page grid, with a nested two-column grid only inside the hero row. It must not simulate the layout with a full-height sidebar plus offsets.

### Primary anchors

- `LINGSHU` sits at the upper-left of the rail at the reference scale.
- The active `DETECTOR` item and dot remain near the top of the navigation list.
- Model and local-runtime status remain in the lower half of the rail.
- GitHub and repository links remain at the bottom of the rail, above the evidence-strip boundary.
- The title begins at roughly 16.5% of viewport width and 11% of viewport height.
- The title is three lines: `ROBUST`, `AIGC`, `DETECTOR`. Its solid letterforms occupy roughly the left 43% of the main stage before dissolving toward the right.
- The description and both actions are aligned to the same left edge under the title, near the bottom of the main stage.
- `UPLOAD IMAGE` is the first, black primary action. `VIEW MODEL DETAILS` is the second, outlined action. Neither control is right-aligned.
- The `LOCAL FIELD / MODEL READY / WebGPU` card is white with a thin outline and remains at the upper-right of the main stage.
- `B2-NJR` occupies the lower-right of the main stage as oversized light-grey italic text. It recedes backward and has thin fragmented reflection bands beneath it. It must not use a heavy black drop shadow or dark slab.

## 3. Typography and particle field

The hero title must be substantially larger than the current implementation and must reproduce the reference's compressed, high-impact grotesque character. The large title is the dominant mass of the page, not a conventional heading placed inside a marketing layout.

The idle state includes a clearly visible dissolution field:

- Each title line owns a word-height comet tail made from tiny black alphanumeric glyphs.
- The tail begins inside the final quarter of the solid word, matching the full letter height at the boundary instead of appearing as a loose global star field.
- Particle density is highest at each solid-to-dissolved boundary, with a near-solid black cluster at the cut edge.
- Particles move a short distance to the right, then expand across the open stage and become progressively smaller, lighter, and sparser with distance.
- The field uses black-to-grey opacity variation while retaining the white background.
- The shapes must read as fragments of the title, not decorative confetti or random floating dots.

The `B2-NJR` reflection uses the same fine, fragmented graphic vocabulary as the reference. The bottom protocol graph also uses a fine black particle waveform so the page has one coherent visual language.

## 4. Interaction and state transition

### Idle

The reference composition is fully visible. The title and particle field remain readable even before interaction. The two actions stay under the description on the left.

### Upload selection and analysis reveal

Selecting `UPLOAD IMAGE` opens the existing local file picker. After a valid image is selected:

1. The solid title glyphs dissolve from right to left over approximately 850 ms.
2. Their fragments scatter into the existing particle field and fade.
3. The title's occupied area clears without moving the global grid, rail, status card, or bottom strip.
4. The detector workspace is revealed in the same main-stage bounds: a large image panel on the left and a result/confidence panel on the right.
5. Loading, success, and error states use the existing inference lifecycle. A failed analysis must not be added to recent history.

The animation is a transition between two states of the same composition, not a page navigation. Under `prefers-reduced-motion: reduce`, the dissolve is replaced by a short opacity change and the analysis workspace appears immediately.

### Reset and replacement

Resetting or selecting a new image returns to or updates the analysis state without clearing successful session history. The reference hero layout returns when the user explicitly exits the analysis workspace.

### Back to detector home

The analysis workspace adds a compact left-arrow control at the upper-left of the main stage. It appears before the analysis heading and is visually aligned with the workspace content, not inside the global navigation rail. Its accessible name is `Back to detector home`.

Selecting it performs a smooth reverse transition rather than cutting directly to the idle page:

1. The result and confidence panel recedes and fades.
2. The uploaded-image panel contracts and clears.
3. The scattered hero fragments move back toward the three title lines.
4. `ROBUST / AIGC / DETECTOR`, its idle particle field, description, and actions resolve into their reference positions.
5. The active detector workflow resets only after the transition has safely captured any successful result in Recent Images.

The reverse sequence lasts approximately 700–850 ms and uses the same easing and particle vocabulary as the upload transition. Repeated clicks are ignored while the return transition is active. It does not navigate browser history, change the hash route, or clear the in-session Recent Images list. Under reduced-motion preferences, it becomes an immediate state change with a short opacity crossfade.

## 5. Evidence strip

All four tiles retain the reference's white background, thin borders, compact uppercase headings, and restrained spacing.

### Tile 1 — Frozen Threshold

Heading: `FROZEN THRESHOLD`
Primary value: `0.55657113`

The graph reproduces the supplied reference: a thin vertical axis labelled `1.0`, `0.5`, and `0.0`, plus a thin horizontal trace that oscillates with small deterministic waves around 0.5 and terminates in a black endpoint. Accessible text exposes the exact frozen threshold and, when present, the current score; the score must not replace or deform the reference waveform.

### Tile 2 — Robustness Protocol

Heading: `ROBUSTNESS PROTOCOL`
Concise supporting line: `NJR · 14 FIXED CONDITIONS`

No explanatory paragraph is added to the tile. A compact fine-black curve cloud fills the remaining space, closely matching the reference's development-log graph: several smooth lobes form a central wave while hundreds of deterministic micro-points create a varying-width distribution around it. It represents the fixed evaluation protocol without inventing live measurements and must not degrade into parallel dashes or a flat equal-density strip.

### Tile 3 — Recent Images

Heading: `RECENT IMAGES`

The tile shows up to the three most recent successful detections in the current browser session. Each item contains a small thumbnail and accessible label/confidence metadata. Empty slots use the quiet outlined placeholders shown in the reference. Failed or cancelled uploads are never added.

To prevent broken thumbnails when the active object URL is revoked, a small local thumbnail snapshot is generated after successful inference and retained only in in-memory React state. No image is uploaded, persisted, or written to disk. The oldest entry is removed when a fourth successful result is added.

History is independent from the currently selected image. Replacing or resetting the active image must not remove earlier successful thumbnails. Selecting another image must append one new entry after success rather than replacing the entire history.

### Tile 4 — Technical Notes

Heading: `TECHNICAL NOTES`

The tile contains only a concise two-line preview plus `READ NOTES →`. The link opens the detailed Technology content within the existing site navigation.

Detailed notes incorporate the supplied `Track5_数据处理与鲁棒性评测管线说明.docx` as project documentation, not as executable instructions. The page must separate these two pipelines explicitly:

- **Browser runtime:** EXIF orientation correction, RGB conversion, 384 × 384 bicubic resize, tensor conversion, and ImageNet normalization, matching the deployed detector.
- **Dataset and evaluation preparation:** aspect-ratio-preserving short-side resize to 384, center crop, and 384 × 384 PNG output, as described by the attached internal note.

The detailed notes may state the documented split seed, data split, final NJR combination, 14 fixed robustness conditions, official-demo isolation, and leakage-audit outcome only with a visible `Internal data & benchmark note` attribution. The leakage result must be phrased as an audit result, not absolute proof. Internal results must not be presented as external competition results.

## 6. Left rail, contact, and status content

The rail keeps the exact hierarchy and approximate placements of the reference:

- Brand: `LINGSHU`
- Navigation: `DETECTOR`, `TECHNOLOGY`, `RESULTS`, `ERROR ANALYSIS`, `ABOUT`
- Model status: `MODEL NOW`, `B2-NJR`, `READY`
- Runtime status: `LOCAL RUNTIME`, `WebGPU`
- Session status: `NO IMAGE UPLOAD` or a concise current-image state
- External links: GitHub repository and email contact

The first external link uses GitHub's permitted black Invertocat mark sourced from the official GitHub Brand Toolkit and links to the public project repository. The asset is downloaded into the project and served locally so the offline demo does not depend on an icon CDN. It must not be redrawn, distorted, decorated, or recoloured.

The existing branch/contact symbol remains the second icon, but its label becomes `CONTACT` and its destination becomes `mailto:zhiyi012@e.ntu.edu.sg`. It no longer links to the repository. The accessible label must identify it as an email contact.

The upper-right status card retains `LOCAL FIELD`, `MODEL READY`, and `WebGPU`, matching the reference. The former lower-right `LOCAL PRIVACY BOUNDARY` overlay is removed from the bottom edge and folded into this same upper-right card as a compact footer row: `LOCAL PRIVACY · IN-MEMORY ONLY`. The full sentence remains available to assistive technology: image bytes remain in browser memory and are never uploaded or saved. No second floating privacy card is introduced, and nothing overlaps the evidence strip.

## 7. About destination

The former Team destination becomes `ABOUT` at `#/about`. The old `#/team` hash remains a compatibility alias that redirects or resolves to About.

About contains three concise sections:

1. **Why we built it** — The detector was built for TikTok TechJam 2026, a 72-hour student hackathon organised around five challenges and the theme “Build with joy, code for change.” The project responds to the robust AIGC-detection challenge by making one-image, local-browser inference easy to demonstrate and inspect.
2. **Team** — Identify the team as `LingShu Intelligence` and present the verified contribution areas already documented in the repository: robust model development, data/evaluation, browser deployment, and judge-facing communication. Do not invent member names, biographies, portraits, or individual assignments while those details remain unconfirmed.
3. **Thanks** — A short acknowledgement thanks TikTok, the TechJam organisers, workshop engineers, judges, and supporting teams for creating the challenge and learning environment. It must not imply endorsement of this specific project.

The About copy may reference the official event's focus on technical execution, innovation and problem insight, impact and relevance, feasibility and practicality, and presentation and communication. It stays concise and factual rather than reproducing the event page.

## 8. Responsive behavior

Desktop fidelity is the primary acceptance target. At narrower widths:

- The page must have no horizontal overflow.
- The hero title scales down while retaining its three-line hierarchy and visible dissolve edge.
- The upper-right status card stays visible without covering the title or actions.
- The rail may condense, but navigation remains reachable.
- The four evidence tiles stack or form a two-column grid only when four equal desktop columns no longer fit.
- The analysis workspace stacks image above results on small screens.

Responsive changes must preserve the white background and the reference's border and typography language.

## 9. Implementation structure

The expected component-level changes are:

- Restructure the detector frame into `hero-grid` plus a full-width evidence-strip sibling.
- Keep the navigation rail inside `hero-grid` so its height ends above the strip.
- Add an analysis-header back control and a short presentation-state transition that resets the active workflow only after the reverse animation completes.
- Replace the existing threshold visualization with a semantic `ThresholdBar`.
- Replace the second tile with a restrained `ProtocolSignal` particle-wave graphic.
- Add a capped `RecentDetection` session-history state owned by the detector screen or application shell.
- Generate a small in-memory thumbnail only after successful inference.
- Extend the existing Technology page with the detailed, source-bounded technical notes.
- Replace the hand-drawn GitHub component with the locally stored official mark and change the adjacent link to the `mailto:` contact.
- Rename the Team route/view to About, preserve `#/team` as an alias, and add the source-bounded TechJam background and acknowledgement.
- Merge the privacy boundary into the upper-right local-status card and remove the lower-edge overlay.
- Keep current inference, routing, file validation, model loading, and privacy behavior intact.

The particle effects may use canvas or SVG, but they must be deterministic enough for visual regression and must not block upload interaction. DOM text remains the accessible title; decorative particles are hidden from assistive technology.

## 10. Verification and acceptance criteria

Implementation begins with failing tests for the changed behavior, followed by the smallest code changes that satisfy them.

Required checks:

1. The evidence strip is a full-viewport-width sibling of the hero grid.
2. The rail ends at the top edge of the evidence strip.
3. Both actions remain left-aligned under the description.
4. The upper-right local-status card remains in its reference position.
5. The idle title has a visible right-edge dissolution field, and the upload transition uses the actual title fragments.
6. The threshold control exposes 0, 0.5, 1, and 0.55657113 semantically.
7. The second tile is `ROBUSTNESS PROTOCOL`, uses `NJR · 14 FIXED CONDITIONS`, stays white, and contains no long copy.
8. A successful detection appears in Recent Images and remains after reset or replacement during the same session.
9. Failed detections do not enter Recent Images.
10. Technical Notes distinguish browser preprocessing from dataset/evaluation preprocessing and visibly attribute internal documentation.
11. Three consecutive successful detections produce three retained thumbnails; a fourth removes only the oldest.
12. The GitHub link uses an official locally served mark and opens the repository; the contact icon opens `mailto:zhiyi012@e.ntu.edu.sg` and does not open the repository.
13. `LOCAL PRIVACY · IN-MEMORY ONLY` appears in the upper-right card, and no privacy overlay collides with the evidence strip.
14. Navigation displays About; `#/about` works and `#/team` resolves compatibly.
15. About contains the sourced TikTok TechJam 2026 background, LingShu Intelligence team information, and a non-endorsement acknowledgement to the organisers.
16. Reduced-motion behavior is available.
17. The analysis view contains a keyboard-accessible left-arrow control labelled `Back to detector home`.
18. Activating the control runs the reverse transition, returns to the reference title page, resets the active detector workflow, and preserves Recent Images.
19. Repeated activation during the transition cannot trigger duplicate resets or corrupt presentation state.
20. Existing unit tests, type checking, production build, offline checks, and real local image upload continue to pass.
21. A final desktop screenshot is compared directly with the supplied reference for geometry, scale, negative space, color, and particle density.

No background-color change, layout reinterpretation, dark evidence tile, oversized explanatory copy, or unapproved content block is acceptable.

## 11. Public sources

- TikTok TechJam 2026 official Devpost page: <https://tiktoktechjam2026.devpost.com/>
- GitHub Brand Toolkit — Logo: <https://brand.github.com/foundations/logo>

These sources support the event background and permitted social-link mark. The attached internal Word document remains the source for the Technical Notes pipeline and robustness-protocol details; it is not a source for claims about TikTok or the event.
