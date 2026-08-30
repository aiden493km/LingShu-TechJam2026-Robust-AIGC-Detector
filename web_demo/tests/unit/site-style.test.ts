import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Semantic Signal visual system', () => {
  it('defines the approved desktop composition and one orchestrated motion system', async () => {
    const css = await readFile(new URL('../../src/app.css', import.meta.url), 'utf8');

    expect(css).toContain('.hero-grid');
    expect(css).toMatch(/\.application-frame\s*\{[^}]*grid-template-rows:/s);
    expect(css).toMatch(/\.hero-grid\s*\{[^}]*grid-template-columns:/s);
    expect(css).toMatch(/\.evidence-strip\s*\{[^}]*width:\s*100%/s);
    expect(css).toContain('.site-rail');
    expect(css).toMatch(/\.site-rail\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s);
    expect(css).toContain('.display-title');
    expect(css).toMatch(/\.display-title\s*\{[^}]*top:\s*10\.2%/s);
    expect(css).toContain('.title-particle-canvas');
    expect(css).toMatch(/\.title-particle-canvas\s*\{[^}]*transform:\s*translateY\(-1\.5rem\)/s);
    expect(css).toContain('.local-field-loading');
    expect(css).toContain('@keyframes local-field-ready');
    const titleParticleLayer = Number(css.match(/\.title-particle-canvas\s*\{[^}]*z-index:\s*(\d+)/s)?.[1]);
    const localFieldLayer = Number(css.match(/\.local-field-card,\s*\.local-field-loading\s*\{[^}]*z-index:\s*(\d+)/s)?.[1]);
    expect(localFieldLayer).toBeGreaterThan(titleParticleLayer);
    expect(css).not.toContain('.title-particle-tail');
    expect(css).not.toContain('.title-fragment');
    expect(css).toContain('#000 0 93%');
    expect(css).toMatch(/\.detector-shell\s*\{[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/\.detector-stage\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*height:\s*auto/s);
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*\.detector-stage\s*\{[^}]*position:\s*relative[^}]*inset:\s*auto/s);
    expect(css).toContain('.model-word');
    expect(css).toMatch(/\.model-word::after\s*\{[^}]*scaleY\(-/s);
    expect(css).toContain('.signal-field');
    expect(css).toContain('.analysis-workspace');
    expect(css).toMatch(/\.hero-description\s*\{[^}]*top:\s*83\.8%/s);
    expect(css).toMatch(/\.hero-actions\s*\{[^}]*top:\s*88%/s);
    expect(css).toContain('.analysis-back');
    expect(css).toContain('.threshold-waveform');
    expect(css).toContain('.protocol-curve-cloud');
    expect(css).toContain('@keyframes protocol-drift-a');
    expect(css).toContain('@keyframes protocol-drift-b');
    expect(css).toContain('@keyframes protocol-drift-c');
    expect(css).toMatch(/\.protocol-centerline\s*\{[^}]*animation:\s*protocol-line-flow/s);
    expect(css).toContain('@keyframes protocol-line-flow');
    expect(css).toMatch(/\.protocol-curve-cloud\s*\{[^}]*bottom:\s*0\.35rem[^}]*height:\s*58%/s);
    expect(css).toMatch(/\.recent-slots\s*\{[^}]*bottom:\s*2\.35rem/s);
    expect(css).toContain('@keyframes title-dissolve');
    expect(css).toContain('@keyframes analysis-return');
    expect(css).toContain('@keyframes particles-reassemble');
    expect(css).toContain('@keyframes signal-weather');
    expect(css).toContain('::view-transition-old(route-content)');
    expect(css).toContain('::view-transition-new(route-content)');
    expect(css).toContain('@keyframes route-fade-in');
    expect(css).toMatch(/\.figure-frame\s*\{[^}]*cursor:\s*zoom-in/s);
    expect(css).toMatch(/\.project-image-lightbox\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0[^}]*rgba\(0,\s*0,\s*0,\s*0\.72\)/s);
    expect(css).toMatch(/\.project-image-lightbox-figure\s*\{[^}]*max-width:\s*min\(78vw,\s*72rem\)/s);
    expect(css).toContain('@keyframes project-image-backdrop-in');
    expect(css).toContain('@keyframes project-image-expand-in');
    expect(css).toMatch(/\.team-intro\s*\{[^}]*width:\s*100%/s);
    expect(css).not.toMatch(/\.technology-layout > div > p,\s*\.team-intro,\s*\.team-contact/);
    expect(css).not.toContain('.privacy-note');
  });

  it('keeps fonts local and preserves mobile and reduced-motion contracts', async () => {
    const css = await readFile(new URL('../../src/app.css', import.meta.url), 'utf8');
    const mobileCss = css.match(/@media \(max-width: 760px\)\s*\{([\s\S]*?)\n\}\n\n@media \(max-width: 430px\)/)?.[1] ?? '';

    expect(css).toContain("font-family: 'League Gothic'");
    expect(css).toContain('/fonts/league-gothic-latin.ttf');
    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*\.project-frame \.site-rail\s*\{[^}]*position:\s*relative[^}]*top:\s*auto[^}]*height:\s*auto/s);
    expect(mobileCss).toMatch(/\.site-rail\s*\{[^}]*grid-template-areas:\s*'brand nav' 'status status'/s);
    expect(mobileCss).toMatch(/\.wordmark\s*\{[^}]*grid-area:\s*brand[^}]*border-bottom:\s*0/s);
    expect(mobileCss).toMatch(/\.site-navigation\s*\{[^}]*grid-area:\s*nav[^}]*border-bottom:\s*0/s);
    expect(mobileCss).toMatch(/\.site-navigation\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)[^}]*padding:\s*0/s);
    expect(mobileCss).toMatch(/\.site-navigation a\s*\{[^}]*min-width:\s*0[^}]*justify-content:\s*center[^}]*text-align:\s*center[^}]*white-space:\s*normal/s);
    expect(mobileCss).toMatch(/\.active-dot\s*\{[^}]*position:\s*absolute[^}]*right:/s);
    expect(mobileCss).toMatch(/\.rail-status\s*\{[^}]*grid-area:\s*status[^}]*border-top:\s*var\(--hairline\)/s);
    expect(mobileCss).toMatch(/\.display-title\s*\{[^}]*top:\s*5\.2%/s);
    expect(mobileCss).toMatch(/\.local-field-card,\s*\.local-field-loading\s*\{[^}]*top:\s*2\.3%[^}]*right:\s*3\.5%[^}]*width:\s*7rem/s);
    expect(mobileCss).toMatch(/\.hero-description\s*\{[^}]*top:\s*65\.8%/s);
    expect(mobileCss).toMatch(/\.hero-actions\s*\{[^}]*top:\s*72\.5%/s);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).not.toMatch(/url\(["']?https?:/i);
  });

  it('serves the official GitHub mark locally instead of drawing it in the app', async () => {
    const app = await readFile(new URL('../../src/App.tsx', import.meta.url), 'utf8');
    const mark = await readFile(new URL('../../public/brands/github-mark.svg', import.meta.url), 'utf8');

    expect(app).toContain('/brands/github-mark.svg');
    expect(app).not.toContain('function GitHubIcon');
    expect(mark).toContain('viewBox="0 0 98 96"');
    expect(mark).toContain('fill="black"');
  });
});
