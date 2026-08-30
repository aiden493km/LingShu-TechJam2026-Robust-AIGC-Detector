import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DetectorEvidence } from '../../src/site/DetectorEvidence';
import {
  buildTitleParticles,
  COMET_FLOW_ACCELERATION_POWER,
  COMET_FLOW_BASE_CYCLES_PER_SECOND,
  DETECTOR_TRAIL_ANGLE_DEGREES,
  DissolveTitle,
  particleFlowOpacity,
  particleFlowProgress,
  particleFontSize,
  particlePath,
  particleStartX,
  particleTrailAngle,
  particleVerticalOffset,
  ROBUST_TRAIL_ANGLE_DEGREES,
  TITLE_TRAIL_ANGLE_DEGREES,
  TITLE_TRAIL_OFFSET_PX,
} from '../../src/site/DissolveTitle';
import { SignalField } from '../../src/site/SignalField';
import { detectorPresentation, formatConfidence } from '../../src/site/presentation';

describe('detector presentation', () => {
  it.each(['booting', 'ready', 'error'] as const)('keeps %s in the title state', (phase) => {
    expect(detectorPresentation(phase)).toBe('idle');
  });

  it.each(['validating', 'preprocessing', 'inferring', 'success'] as const)(
    'moves %s into the analysis state',
    (phase) => expect(detectorPresentation(phase)).toBe('analysis'),
  );

  it('keeps eight-decimal confidence precision', () => {
    expect(formatConfidence(0.99999966)).toBe('0.99999966');
    expect(formatConfidence(0.5)).toBe('0.50000000');
  });

  it('renders a deterministic semantic field without accessible noise', () => {
    const first = renderToStaticMarkup(createElement(SignalField));
    const second = renderToStaticMarkup(createElement(SignalField));

    expect(first).toBe(second);
    expect(first).toContain('aria-hidden="true"');
    expect(first.match(/<i/g)).toHaveLength(320);
  });

  it('renders one canvas-backed title field instead of hundreds of animated DOM nodes', () => {
    const first = renderToStaticMarkup(createElement(DissolveTitle));
    const second = renderToStaticMarkup(createElement(DissolveTitle));

    expect(first).toBe(second);
    expect(first).toContain('<span class="title-word">ROBUST</span>');
    expect(first).toContain('<span class="title-word">AIGC</span>');
    expect(first).toContain('<span class="title-word">DETECTOR</span>');
    expect(first).toContain('class="title-particle-canvas"');
    expect(first).not.toContain('class="title-particle-tail"');
    expect(first).not.toContain('class="title-fragment"');
    expect(first).toContain('aria-hidden="true"');
  });

  it('builds dense particles on tightening three-, five-, and nine-degree comet paths', () => {
    const particles = buildTitleParticles();

    expect(particles).toHaveLength(3000);
    expect(ROBUST_TRAIL_ANGLE_DEGREES).toBe(3);
    expect(TITLE_TRAIL_ANGLE_DEGREES).toBe(5);
    expect(DETECTOR_TRAIL_ANGLE_DEGREES).toBe(9);
    expect(particleTrailAngle(0)).toBe(3);
    expect(particleTrailAngle(1)).toBe(5);
    expect(particleTrailAngle(2)).toBe(9);
    expect(new Set(particles.map(({ lineIndex }) => lineIndex))).toEqual(new Set([0, 1, 2]));
    expect(particlePath(0, 0).center).toBe(particlePath(1, 0).center);
    expect(particlePath(1, 0).center).toBe(particlePath(2, 0).center);
    expect(particlePath(0, 0).spread).toBe(particlePath(1, 0).spread);
    expect(particlePath(1, 0).spread).toBe(particlePath(2, 0).spread);
    for (const lineIndex of [0, 1, 2] as const) {
      const line = particles.filter((particle) => particle.lineIndex === lineIndex);
      expect(line.some(({ driftX }) => driftX < 0)).toBe(true);
      expect(line.some(({ driftX }) => driftX > 0)).toBe(true);
      expect(line.some(({ driftY }) => driftY < 0)).toBe(true);
      expect(line.some(({ driftY }) => driftY > 0)).toBe(true);
      expect(particlePath(lineIndex, 1).spread).toBeLessThan(particlePath(lineIndex, 0).spread);
      expect(particlePath(lineIndex, 0).center).toBeGreaterThanOrEqual(0.62);
      expect(particlePath(lineIndex, 1).spread).toBeLessThanOrEqual(0.16);
      const startY = particleVerticalOffset(lineIndex, 0, 0, 180);
      const endY = particleVerticalOffset(lineIndex, 1, 400, 180);
      const visualAngle = Math.atan2(startY - endY, 400) * 180 / Math.PI;
      expect(endY).toBeLessThan(startY);
      const pathAngle = particleTrailAngle(lineIndex);
      expect(visualAngle).toBeGreaterThanOrEqual(pathAngle);
      expect(visualAngle).toBeLessThan(pathAngle + 2);
    }
    expect(new Set([0, 1, 2].map((lineIndex) => particlePath(lineIndex as 0 | 1 | 2, 0.7).center)).size).toBe(3);
    const endpointHeights = ([0, 1, 2] as const).map(
      (lineIndex) => particleVerticalOffset(lineIndex, 1, 400, 180),
    );
    expect(new Set(endpointHeights.map((height) => height.toFixed(3))).size).toBe(3);
    expect(particleFontSize(180, 0)).toBeGreaterThan(4.5);
    expect(particleFontSize(180, 1)).toBeGreaterThan(particleFontSize(180, 0));
    expect(particleFontSize(180, 2)).toBeGreaterThan(particleFontSize(180, 1));
  });

  it('moves every particle trail five pixels left without changing the title geometry', () => {
    expect(TITLE_TRAIL_OFFSET_PX).toBe(5);
    expect(particleStartX(640, 400)).toBeCloseTo(640 - 400 * 0.055 + 5, 8);
  });

  it('keeps particle density highest at the title and progressively lower toward the tail end', () => {
    const firstLine = buildTitleParticles().filter(({ lineIndex }) => lineIndex === 0);

    for (const elapsedSeconds of [0, 5, 10, 15]) {
      const bins: [number, number, number, number] = [0, 0, 0, 0];
      for (const particle of firstLine) {
        const progress = particleFlowProgress(particle.progress, particle.driftX, elapsedSeconds);
        const bin = Math.min(3, Math.floor(progress * 4));
        bins[bin] = (bins[bin] ?? 0) + 1;
      }

      expect(bins[0]).toBeGreaterThan(bins[1]);
      expect(bins[1]).toBeGreaterThan(bins[2]);
      expect(bins[2]).toBeGreaterThan(bins[3]);
      expect(bins[0]).toBeGreaterThan(bins[3] * 1.5);
    }
  });

  it('advances particles toward the narrow end with visible acceleration and a wrapped-end fade', () => {
    expect(COMET_FLOW_BASE_CYCLES_PER_SECOND).toBe(0.044);
    expect(COMET_FLOW_ACCELERATION_POWER).toBeGreaterThan(1);

    const elapsedStep = 0.05;
    const earlyStart = particleFlowProgress(0.15, 0, 0);
    const earlyEnd = particleFlowProgress(0.15, 0, elapsedStep);
    const lateStart = particleFlowProgress(0.8, 0, 0);
    const lateEnd = particleFlowProgress(0.8, 0, elapsedStep);

    expect(earlyEnd).toBeGreaterThan(earlyStart);
    expect(lateEnd).toBeGreaterThan(lateStart);
    expect(lateEnd - lateStart).toBeGreaterThan(earlyEnd - earlyStart);
    expect(particleFlowOpacity(0.5)).toBeGreaterThan(particleFlowOpacity(0.98));
    expect(particleFlowOpacity(0.5)).toBeGreaterThan(particleFlowOpacity(0.005));
  });

  it('renders the reference threshold waveform and curved protocol cloud', () => {
    const markup = renderToStaticMarkup(createElement(DetectorEvidence, {
      score: undefined,
      recentDetections: [],
    }));

    expect(markup).toContain('aria-label="Frozen threshold waveform from 0.0 to 1.0"');
    expect(markup).toContain('class="threshold-waveform"');
    expect(markup).toContain('>1.0</text>');
    expect(markup).toContain('>0.5</text>');
    expect(markup).toContain('>0.0</text>');
    expect(markup).toContain('class="threshold-reference-line"');
    const endpointY = Number(markup.match(/class="threshold-endpoint"[^>]*cy="([^"]+)"/)?.[1]);
    expect(endpointY).toBeCloseTo(79 - 0.55657113 * 73, 7);
    expect(markup).toContain('class="protocol-curve-cloud"');
    expect(markup.match(/class="protocol-particle-band band-/g)).toHaveLength(3);
    expect(markup.match(/<circle/g)?.length ?? 0).toBeGreaterThanOrEqual(220);
  });
});
