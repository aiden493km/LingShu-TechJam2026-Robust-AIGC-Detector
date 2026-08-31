import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ProjectView } from '../../src/site/ProjectViews';

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

const portraits = [
  { name: 'Jingxuan Qian', src: '/team/jingxuan-qian.png' },
  { name: 'Tianshi Bu', src: '/team/tianshi-bu.png' },
  { name: 'Zhiyi Li', src: '/team/zhiyi-li.png' },
  { name: 'Mingxuan Chen', src: '/team/mingxuan-chen.png' },
] as const;

describe('LingShu Intelligence team roster', () => {
  it('renders four confirmed members in the approved order', () => {
    const html = renderToStaticMarkup(createElement(ProjectView, { route: 'about' }));
    const positions = members.map(({ name }) => html.indexOf(name));

    expect(html.match(/class="team-profile"/g) ?? []).toHaveLength(4);
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(html.match(/01 \/ TEAM LEAD/g) ?? []).toHaveLength(1);
  });

  it('exposes the exact roles, contributions, and GitHub destinations', () => {
    const html = renderToStaticMarkup(createElement(ProjectView, { route: 'about' }));

    for (const member of members) {
      expect(html).toContain(member.eyebrow);
      expect(html).toContain(member.role.replaceAll('&', '&amp;'));
      expect(html).toContain(member.contribution);
      expect(html).toContain(`href="${member.url}"`);
      expect(html).toContain(`aria-label="Visit ${member.name} on GitHub"`);
      expect(html).toContain(member.label);
    }

    expect(html.match(/class="team-profile-github"/g) ?? []).toHaveLength(4);
    expect(html.match(/target="_blank"/g) ?? []).toHaveLength(5);
    expect(html.match(/rel="noreferrer"/g) ?? []).toHaveLength(5);
  });

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

  it('gives the About header its local wide-summary class', () => {
    const html = renderToStaticMarkup(createElement(ProjectView, { route: 'about' }));

    expect(html).toContain('class="project-header about-header"');
  });
});
