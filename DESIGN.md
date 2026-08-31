---
name: LingShu Robust AIGC Detector
description: A paper-white local inference interface shaped as Semantic Signal Weather.
colors:
  paper: "#f8f8f8"
  ink: "#0a0a0a"
  silver: "#b3b4b7"
  mid-ink: "#6c6d70"
  hairline: "#b9b9b9"
  team-signal-red: "#b5122b"
typography:
  display:
    fontFamily: "League Gothic, Impact, sans-serif"
    fontSize: "clamp(8rem, 10.55vw, 10.8rem)"
    fontWeight: 400
    lineHeight: 0.79
    letterSpacing: "0.012em"
  headline:
    fontFamily: "League Gothic, Impact, sans-serif"
    fontSize: "clamp(6.5rem, 11vw, 11rem)"
    fontWeight: 400
    lineHeight: 0.82
    letterSpacing: "0.015em"
  metric:
    fontFamily: "League Gothic, Impact, sans-serif"
    fontSize: "clamp(2rem, 2.9vw, 3.15rem)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.025em"
  body:
    fontFamily: "Tahoma, Verdana, sans-serif"
    fontSize: "clamp(0.88rem, 1.1vw, 1rem)"
    fontWeight: 400
    lineHeight: 1.35
  label:
    fontFamily: "Tahoma, Verdana, sans-serif"
    fontSize: "0.66rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.11em"
  navigation:
    fontFamily: "Tahoma, Verdana, sans-serif"
    fontSize: "0.66rem"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "0.12em"
rounded:
  square: "0"
spacing:
  unit: "1rem"
  control-block: "0.75rem"
  control-inline: "1.15rem"
  section-fluid: "clamp(2.5rem, 5vw, 5.5rem)"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "{spacing.control-block} {spacing.control-inline}"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "{spacing.control-block} {spacing.control-inline}"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "{spacing.control-block} {spacing.control-inline}"
    height: "44px"
  navigation-item:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.navigation}"
    rounded: "{rounded.square}"
    padding: "0.75rem 1.05rem"
    height: "3.35rem"
  navigation-item-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.navigation}"
    rounded: "{rounded.square}"
    padding: "0.75rem 1.05rem"
    height: "3.35rem"
  evidence-panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    padding: "1.15rem clamp(0.9rem, 1.4vw, 1.5rem)"
---

# Design System: LingShu Robust AIGC Detector

## Overview

**Creative North Star: "Semantic Signal Weather"**

Semantic Signal Weather turns local model inference into a severe editorial instrument: a nearly white paper field, carbon-black type, receding silver model notation, hairline rules, and a sparse weather system made from the model's own letters and numbers. The interface stays concise and technical, with one monumental condensed voice for decisions and one compact system voice for controls, evidence, and runtime truth.

The system is flat, square, and offline-native. Structure comes from rules, inverse fills, scale, and controlled density rather than rounded cards, shadows, gradients, or remote visual dependencies. Expression concentrates in the local signal particles and the detector's single title-to-analysis dissolve; project evidence remains plainly framed and separately labeled.

**Key Characteristics:**

- Paper-white fields divided by one-pixel gray rules.
- Monumental local League Gothic display type paired with compact Tahoma/Verdana system copy.
- Carbon-black inverse states and silver receding notation, with one locally scoped dark-red signal in the team roster.
- Square controls, panels, markers, and evidence frames with no general elevation.
- Local semantic particles and one orchestrated transition from title to analysis.

## Colors

The palette is an achromatic hierarchy in which contrast, not hue, communicates priority.

### Primary

- **Carbon Ink:** The dominant text, line, icon, active-navigation, primary-action, and inverse-panel color.

### Secondary

- **Receding Silver:** Monumental model notation and deliberately subordinate display information.
- **Mid Ink:** Supporting copy, diagnostic labels, progress text, and secondary evidence captions.
- **Team Signal Red:** A local `#b5122b` accent used only for the About roster's corner ticks and team-lead eyebrow.

### Neutral

- **Paper Field:** The application canvas and default control or panel surface.
- **Hairline Gray:** The one-pixel structural rule used to divide navigation, stages, lists, and content regions.

### Named Rules

**The Inversion Rule.** Important interactive states invert Paper Field and Carbon Ink; they do not use the team signal as a generic state color.

**The Team Signal Exception.** Team Signal Red is scoped to `.team-section` and remains non-interactive. It must not become a global brand, success, warning, error, or navigation token.

**The Evidence-Is-Content Rule.** Colors inside supplied evaluation figures belong to those figures and never become interface tokens or generic result states.

## Typography

**Display Font:** League Gothic (with Impact and sans-serif fallbacks), loaded from the committed local font file.

**Body Font:** Tahoma (with Verdana and sans-serif fallbacks).

**Character:** League Gothic makes titles, decisions, model identifiers, and metrics feel monumental without spending horizontal space. Tahoma/Verdana keeps the operating layer compact, familiar, and readable at small sizes.

### Hierarchy

- **Display** (400, `clamp(8rem, 10.55vw, 10.8rem)`, 0.79): The three-line detector title; uppercase and horizontally stretched per line.
- **Headline** (400, `clamp(6.5rem, 11vw, 11rem)`, 0.82): Directly addressable project-view titles.
- **Metric** (400, `clamp(2rem, 2.9vw, 3.15rem)`, 1): Thresholds, model identifiers, evidence values, and large numeric readouts.
- **Body** (400, `clamp(0.88rem, 1.1vw, 1rem)`, 1.35): Explanatory copy and project-view summaries, generally held to about 39–42rem.
- **Label** (800, 0.66rem, 0.11em): Controls and compact operating labels; predominantly uppercase with wide tracking.

### Named Rules

**The Local Type Rule.** League Gothic must come from the committed local asset; never replace it with a remote font request.

**The Two-Voice Rule.** League Gothic carries display facts and outcomes; Tahoma/Verdana carries actions, navigation, explanation, and evidence context.

## Layout

Desktop uses a full-height application grid with a sticky left rail at `clamp(9rem, 10vw, 10rem)` and a fluid main field. The detector entry surface divides the main field into an 80vh stage and a 20vh four-column evidence strip; the analysis state preserves the rail while splitting its workspace into a large image field and a narrower decision rail. Secondary project views reuse the rail, monumental header, fluid section padding, and ruled grid.

At 1020px the rail contracts to 8.3rem, the analysis split tightens, and the team roster changes from four columns to two. At the 760px transition the rail becomes a two-row horizontal header, navigation scrolls horizontally, the analysis workspace and team roster become one column, and the evidence strip becomes two columns. At 430px the evidence strip becomes single-column. The implementation supports widths down to 320px.

**The Rail-to-Strip Rule.** Preserve the 10vw desktop rail and switch the application frame at 760px; do not scale the desktop rail down into an unusable sliver.

## Elevation & Depth

The system has no reusable box-shadow or gradient vocabulary. Depth is built with figure/ground inversion, pale tonal surfaces, occlusion, typography scale, and one-pixel or four-pixel rules. The multi-offset shadow behind the silver `B2-NJR` word is a hero-only signature that makes that exact model name recede; it is not an elevation token and must not appear on cards, controls, navigation, or ordinary headings.

### Named Rules

**The Flat Signal Plane Rule.** Keep normal surfaces flat; separate them with rules, inverse fills, and spatial hierarchy rather than shadows or gradients.

## Shapes

The form language is square (`0` radius). Buttons, navigation states, status cards, evidence frames, recent-image slots, and alerts retain hard corners. One-pixel hairlines form the dominant boundary language; four-pixel black rules mark completed processing and figure captions. Small squares identify active navigation, while the confidence marker rotates a bordered square into a diamond without introducing a rounded motif.

**The Square Instrument Rule.** Do not round controls or containers; precision comes from straight rules and orthogonal geometry.

## Components

### Buttons

- **Shape:** Square with a one-pixel Carbon Ink border and a minimum target height of 44px.
- **Primary:** Carbon Ink surface, Paper Field text, and compact bold label typography with `0.75rem 1.15rem` padding.
- **Secondary:** Paper Field surface with Carbon Ink text and the same dimensions.
- **Hover / Focus:** Hover and keyboard focus invert the surface and text. Keyboard focus also receives a three-pixel Carbon Ink outline with a three-pixel offset.
- **Disabled:** The upload label uses the implemented gray text, border, and surface values and a wait cursor while model selection is unavailable.

### Navigation

The desktop rail stacks 3.35rem items beneath the wordmark. Current and hovered items invert to Carbon Ink with Paper Field text; the current item also carries a small filled square. At 760px, the same items form a horizontally scrollable row with four-rem targets.

### Cards / Containers

Containers are rule-bound regions rather than floating cards. Quick-reference evidence blocks use Paper Field and hairline dividers, with one implemented inverse black block for the model development log. Figure panels use a pale neutral backing, a one-pixel Carbon Ink frame, and a four-pixel caption rule. No container receives a general shadow.

### Inputs / Fields

The product has no visible generic text-field primitive. Its real input is a visually hidden file input paired with the primary upload label; drag-over state outlines the detector stage with a six-pixel inset Carbon Ink rule. Do not invent a rounded drop zone or a conventional text input style from this workflow.

### Analysis Result

The analysis workspace pairs a contained preview with a ruled result rail. A large League Gothic decision, tabular confidence value, hairline confidence scale, right-aligned detail values, and a four-pixel completion rule establish the outcome hierarchy. Retry, reset, and model-detail actions reuse the two button variants.

### Signal Field

The recurring field contains 96 locally rendered semantic characters from `B2NJR01AIGC384FP32LOCAL`. Particles drift on a 6.4-second alternating ease-in-out cycle and remain pointer-inert and hidden from assistive technology. Reduced-motion mode collapses animation duration and iteration count.

### Detector Transition

Selecting an image triggers one orchestrated title dissolve: the idle hero fades over 0.82 seconds, three title lines fracture with a short stagger, and the analysis layer reveals after a 0.46-second delay. This motion belongs only to the detector's change of operating state and must never delay interaction under reduced-motion preferences.

**The One Dissolve Rule.** Reserve the title-fracture and analysis reveal for the detector's idle-to-analysis transition; do not replay it on route changes or ordinary component states.

### Team Roster

The About roster is an ordered, flat profile grid: four equal columns on wide
screens, two at 1020px and below, and one at 760px and below. Every profile keeps
the same square empty portrait frame, eyebrow, name, role, contribution, and
GitHub-link hierarchy. The portrait frame uses a one-pixel Carbon Ink outline and
two short Team Signal Red corner ticks. Cards remain square, shadowless, and
motionless; the team lead is distinguished only by the approved eyebrow color.

## Do's and Don'ts

### Do:

- **Do** keep Paper Field, Carbon Ink, Receding Silver, Mid Ink, and Hairline Gray as the reusable interface palette.
- **Do** maintain square corners, hairline structure, and 44px minimum control targets.
- **Do** keep signal particles local, semantic, pointer-inert, and decorative to assistive technology.
- **Do** preserve visible `:focus-visible`, reduced-motion, and forced-colors behavior.
- **Do** keep evidence scope in content labels and captions rather than encoding it as generic visual status tokens.
- **Do** keep Team Signal Red local to the roster's approved corner ticks and lead eyebrow.

### Don't:

- **Don't** add gradients, general shadows, glass effects, rounded cards, or remote fonts.
- **Don't** reuse the `B2-NJR` multi-offset text shadow as an elevation style.
- **Don't** use the title-dissolve for navigation, hover, loading loops, or secondary pages.
- **Don't** turn figure-specific colors or evidence labels into brand, accuracy, success, or failure tokens.
- **Don't** reuse Team Signal Red for navigation, buttons, runtime status, or detector outcomes.
- **Don't** collapse the 760px mobile transition into a narrow fixed rail or reduce controls below 44px.
