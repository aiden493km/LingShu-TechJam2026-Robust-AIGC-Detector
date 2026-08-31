# LingShu Intelligence Team Portrait Integration Design

**Date:** 2026-08-31

**Status:** User-approved design; implementation plan pending

**Scope:** Add the four user-supplied portraits to the existing About-page Signal Roster and widen the two About introduction text measures without changing member order, copy, links, or responsive structure

## 1. Goal

Replace the four intentionally empty roster frames with the four approved square
portrait images. Preserve the existing flat, square, paper-and-ink design, red
corner ticks, four/two/one-column responsive behavior, and all confirmed member
content.

The supplied images are already square at 1254 × 1254. They must be used as
provided: no generated replacement, face alteration, manual crop, style transfer,
or recompression is introduced in this task.

## 2. Authoritative image mapping

The user's upload order is authoritative. Copy the exact source bytes into stable,
semantic public paths as follows:

| Upload | Member | Source SHA-256 | Public path |
|---:|---|---|---|
| 1 | Tianshi Bu | `69d16b54862ba518890dd728eef8d9dd0213cbbcca6283314c8c9a1f07cdd988` | `/team/tianshi-bu.png` |
| 2 | Mingxuan Chen | `356d31400fda527518259ac0e78d2a02f677a950ed4684dfc5b5c3bf1fde5d41` | `/team/mingxuan-chen.png` |
| 3 | Jingxuan Qian | `d1114ea9b8515b2e2a207dc8ce5955b7d772ed29e9e5c399e69f19e7a6448be6` | `/team/jingxuan-qian.png` |
| 4 | Zhiyi Li | `a81f98a6436edb50bdb52369f1714600f6a0f9353eb4049d07419addc511b3c8` | `/team/zhiyi-li.png` |

The visible roster order remains Jingxuan Qian, Tianshi Bu, Zhiyi Li, Mingxuan
Chen. Upload order must not be mistaken for display order.

## 3. Component contract

Extend each immutable `TeamMember` record with `portraitSrc` and `portraitAlt`.
The approved alternative text is `<member name> portrait`, for example
`Jingxuan Qian portrait`.

Each `.team-portrait-frame` contains one semantic `<img>` with:

- the exact mapped public path;
- the approved alternative text;
- intrinsic `width="1254"` and `height="1254"` to reserve square layout space;
- `loading="lazy"`; and
- `decoding="async"`.

Because the portrait is meaningful member content, the frame is no longer hidden
from assistive technology. The frame itself needs no additional accessible label;
the image alternative text supplies the member identity.

## 4. Visual treatment

The image fills the existing square frame with `width: 100%`, `height: 100%`, and
`object-fit: cover`. Since every source is square, this produces proportional
scaling without an intentional crop. Use centered positioning consistently rather
than per-person offsets.

Keep the one-pixel black frame and both dark-red corner ticks. The ticks remain
above the image through a local stacking order, and the frame clips only content
that reaches its square boundary. Do not add circles, masks, filters, blend modes,
hover zoom, animation, captions, shadows, or rounded corners.

The existing card dimensions and four/two/one-column breakpoints remain unchanged.

## 5. Asset and delivery behavior

Store the portraits under `web_demo/public/team/`. Vite copies them into the same
paths under the committed `web_demo/dist/team/` delivery artifact. The page uses
only local relative assets and introduces no remote request, upload API, or content
management layer.

The source assets total roughly 9.4 MB. This task prioritizes exact user-supplied
bytes and avoids a lossy derivative. Lazy loading prevents the browser from
prioritizing portraits before they approach the viewport.

## 6. Testing and verification

Implementation follows test-driven development:

1. Update the roster test first and observe failure against the empty frames.
2. Require four images in roster display order, each paired with the correct
   member name, exact public path, alternative text, intrinsic dimensions, lazy
   loading, and asynchronous decoding.
3. Require the former empty/decorative-frame contract to be absent.
4. Extend the style test for full-frame proportional images and red ticks stacked
   above them.
5. Copy the four assets and verify their destination hashes equal the source
   hashes listed above.
6. Run the focused tests, full Vitest suite, TypeScript, and `verify:dist`.
7. Inspect `#/about` at representative desktop, tablet, and mobile sizes for
   correct person-to-image mapping, undistorted portraits, visible corner ticks,
   stable card layout, and no horizontal overflow.

## 7. About copy-width refinement

The About header summary currently inherits the shared 39rem project-header text
measure, which forces an awkward desktop break after “TikTok TechJam.” Give only
the About header a local `about-header` class and increase its summary measure to
64rem. Other route headers retain the shared 39rem rule.

The `WHY WE BUILT IT` paragraph currently stops at 58rem. Increase only
`.about-origin p` to a 72rem maximum measure so the event description uses the
available desktop field more naturally. The change remains a maximum width, not a
fixed width, so tablet and mobile layouts continue to wrap inside their available
space without horizontal scrolling.

Do not change either sentence, typography, font size, padding, section order, or
the width of the `THANKS` paragraph.

## 8. Documentation updates

Update the live roster design, product/design contracts, repository agent guide,
root README, and WebDemo runbook so they no longer describe the frames as empty or
awaiting approved images. Preserve the rule that no additional portraits or
biographical claims may be invented.

## 9. Scope exclusions

This task does not:

- change the confirmed names, roles, contribution copy, GitHub links, or roster order;
- regenerate, retouch, crop, or recompress the supplied portraits;
- change detector inference, model loading, or privacy behavior;
- modify or merge the separate Vercel online-deployment worktree; or
- push, merge, or deploy the About branch.
