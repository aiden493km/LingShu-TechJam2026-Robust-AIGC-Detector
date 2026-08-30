import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  ProjectImageLightbox,
  ProjectView,
  shouldDismissProjectImageLightbox,
  shouldDismissProjectImageLightboxFromKey,
} from '../../src/site/ProjectViews';

describe('project evidence views', () => {
  it.each([
    ['technology', 'TECHNOLOGY'],
    ['results', 'RESULTS'],
    ['errors', 'ERROR ANALYSIS'],
    ['about', 'ABOUT'],
  ] as const)('renders the %s destination', (route, heading) => {
    const html = renderToStaticMarkup(createElement(ProjectView, { route }));
    expect(html).toContain(heading);
  });

  it('keeps model and evidence facts explicit and separated', async () => {
    const source = await readFile(new URL('../../src/site/ProjectViews.tsx', import.meta.url), 'utf8');

    expect(source).toContain('0.55657113');
    expect(source).toContain('B2-NJR');
    expect(source).toContain('WebGPU');
    expect(source).toContain('WASM');
    expect(source).toContain('pipeline_overview.png');
    expect(source).toContain('final_heldout_results.png');
    expect(source).toContain('external_benchmark.png');
    expect(source).toContain('error_clean_confusion.png');
    expect(source).toContain('error_condition_rates.png');
    expect(source).toContain('error_b1_b2_transition.png');
    expect(source).toContain('error_failure_cases.png');
    expect(source).not.toContain('error_analysis_concept.png');
    expect(source).toContain('Profiles pending team confirmation');
    expect(source).toContain('BROWSER RUNTIME');
    expect(source).toContain('DATASET & EVALUATION PREPARATION');
    expect(source).toContain('NJR');
    expect(source).toContain('14 FIXED CONDITIONS');
    expect(source).toContain('Internal data & benchmark note');
    expect(source).toContain('not absolute proof');
    expect(source).not.toContain('CUDA');
    expect(source).not.toContain('batch inference');
  });

  it('explains the sourced event background, team, and thanks without implying endorsement', () => {
    const html = renderToStaticMarkup(createElement(ProjectView, { route: 'about' }));

    expect(html).toContain('ABOUT');
    expect(html).toContain('LingShu Intelligence');
    expect(html).toContain('TikTok TechJam 2026');
    expect(html).toContain('72-hour');
    expect(html).toContain('Build with joy, code for change');
    expect(html).toContain('Thank you');
    expect(html).toContain('does not imply endorsement');
  });

  it('presents the frozen B2-NJR error analysis as measured evidence with an explicit test-set boundary', () => {
    const html = renderToStaticMarkup(createElement(ProjectView, { route: 'errors' }));

    expect(html).toContain('19 / 4,485');
    expect(html).toContain('6 FP');
    expect(html).toContain('13 FN');
    expect(html).toContain('BLUR σ=2.0');
    expect(html).toContain('10.00% FPR');
    expect(html).toContain('RESIZE ×0.25');
    expect(html).toContain('10.65% FNR');
    expect(html).toContain('1,611');
    expect(html).toContain('327');
    expect(html).toContain('79.7%');
    expect(html).toContain('0.55657113');
    expect(html).toContain('NO TEST-SET RETUNING');
    expect(html).toContain('REPRESENTATIVE FAILURE CASES');
  });

  it.each([
    ['technology', 1],
    ['results', 2],
    ['errors', 4],
  ] as const)('makes every %s evidence image open the shared dialog', (route, imageCount) => {
    const html = renderToStaticMarkup(createElement(ProjectView, { route }));

    expect(html.match(/class="figure-frame"/g)).toHaveLength(imageCount);
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(imageCount);
    expect(html.match(/aria-label="Enlarge [^"]+ image"/g)).toHaveLength(imageCount);
  });

  it('renders an appropriately bounded modal image and exposes outside-click and Escape dismissal', () => {
    const image = {
      src: '/assets/figure.png',
      alt: 'Expanded evaluation figure',
      title: 'HELD-OUT EVALUATION',
    };
    const html = renderToStaticMarkup(createElement(ProjectImageLightbox, {
      image,
      onClose: () => undefined,
    }));
    const backdrop = {};
    const innerFigure = {};

    expect(html).toContain('class="project-image-lightbox"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('HELD-OUT EVALUATION enlarged image');
    expect(html).toContain('Expanded evaluation figure');
    expect(html).toContain('CLOSE');
    expect(shouldDismissProjectImageLightbox(backdrop, backdrop)).toBe(true);
    expect(shouldDismissProjectImageLightbox(innerFigure, backdrop)).toBe(false);
    expect(shouldDismissProjectImageLightboxFromKey('Escape')).toBe(true);
    expect(shouldDismissProjectImageLightboxFromKey('Enter')).toBe(false);
  });

  it('wires non-detector hash routes into the project view without recreating the detector hook', async () => {
    const source = await readFile(new URL('../../src/App.tsx', import.meta.url), 'utf8');

    expect(source.match(/useDetector\(\)/g)).toHaveLength(1);
    expect(source).toContain('<ProjectView route={route} />');
  });
});
