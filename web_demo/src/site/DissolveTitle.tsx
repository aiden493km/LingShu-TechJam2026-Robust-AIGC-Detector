import { useEffect, useRef } from 'react';

const TITLE_WORDS = ['ROBUST', 'AIGC', 'DETECTOR'] as const;
const FRAGMENT_GLYPHS = '0238B2NJR01AIGC';
const PARTICLES_PER_LINE = 1000;
const FRAME_INTERVAL_MS = 1000 / 30;
export const TITLE_TRAIL_OFFSET_PX = 5;
export const TITLE_TRAIL_ANGLE_DEGREES = 5;
export const DETECTOR_TRAIL_ANGLE_DEGREES = 9;
export const COMET_FLOW_BASE_CYCLES_PER_SECOND = 0.044;
export const COMET_FLOW_ACCELERATION_POWER = 1.4;
const COMET_FLOW_RATE_VARIATION = 0.01;
const TITLE_TRAIL_SLOPES = [
  Math.tan(TITLE_TRAIL_ANGLE_DEGREES * Math.PI / 180),
  Math.tan(TITLE_TRAIL_ANGLE_DEGREES * Math.PI / 180),
  Math.tan(DETECTOR_TRAIL_ANGLE_DEGREES * Math.PI / 180),
] as const;

type TitleLineIndex = 0 | 1 | 2;

export interface TitleParticleBlueprint {
  readonly lineIndex: TitleLineIndex;
  readonly progress: number;
  readonly verticalNoise: number;
  readonly driftX: number;
  readonly driftY: number;
  readonly phase: number;
  readonly opacity: number;
  readonly sizeIndex: 0 | 1 | 2;
  readonly glyph: string;
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function particlePath(lineIndex: TitleLineIndex, progress: number) {
  const p = Math.max(0, Math.min(1, progress));
  const centers = [
    0.62 + Math.sin(p * Math.PI * 1.2) * 0.075 * (1 - p * 0.45),
    0.62 + Math.sin(p * Math.PI * 1.9) * 0.085 * (1 - p * 0.6),
    0.62 - Math.sin(p * Math.PI * 0.85) * 0.07 * (1 - p * 0.35),
  ] as const;
  return {
    center: centers[lineIndex],
    spread: 0.84 - 0.7 * p,
  };
}

export function particleStartX(lineRight: number, lineWidth: number) {
  return lineRight - lineWidth * 0.055 + TITLE_TRAIL_OFFSET_PX;
}

export function particleTrailAngle(lineIndex: TitleLineIndex) {
  return lineIndex === 2 ? DETECTOR_TRAIL_ANGLE_DEGREES : TITLE_TRAIL_ANGLE_DEGREES;
}

export function particleFlowProgress(seedProgress: number, driftX: number, elapsedSeconds: number) {
  const flowRate = COMET_FLOW_BASE_CYCLES_PER_SECOND
    + ((Math.max(-1, Math.min(1, driftX)) + 1) / 2) * COMET_FLOW_RATE_VARIATION;
  const cycleProgress = (
    Math.max(0, Math.min(1, seedProgress))
    + Math.max(0, elapsedSeconds) * flowRate
  ) % 1;
  return Math.pow(cycleProgress, COMET_FLOW_ACCELERATION_POWER);
}

export function particleFlowOpacity(progress: number) {
  const p = Math.max(0, Math.min(1, progress));
  const sourceFade = Math.min(1, p / 0.025);
  const endpointFade = Math.min(1, (1 - p) / 0.08);
  return Math.max(0, Math.min(sourceFade, endpointFade));
}

export function particleVerticalOffset(
  lineIndex: TitleLineIndex,
  progress: number,
  distancePx: number,
  lineHeight: number,
) {
  return particlePath(lineIndex, progress).center * lineHeight - distancePx * TITLE_TRAIL_SLOPES[lineIndex];
}

export function particleFontSize(lineHeight: number, sizeIndex: 0 | 1 | 2) {
  return Math.max(4.2, lineHeight * (0.028 + sizeIndex * 0.009));
}

export function buildTitleParticles(): readonly TitleParticleBlueprint[] {
  return ([0, 1, 2] as const).flatMap((lineIndex) => {
    const random = seededRandom(0xb2_0a_1c + lineIndex * 9_973);
    return Array.from({ length: PARTICLES_PER_LINE }, (_, index) => {
      const progress = (index + random()) / PARTICLES_PER_LINE;
      return {
        lineIndex,
        progress,
        verticalNoise: random() * 2 - 1,
        driftX: random() * 2 - 1,
        driftY: random() * 2 - 1,
        phase: random() * Math.PI * 2,
        opacity: Math.max(0.16, 0.96 - progress * 0.76),
        sizeIndex: Math.floor(random() * 3) as 0 | 1 | 2,
        glyph: FRAGMENT_GLYPHS[(index * 7 + lineIndex * 5) % FRAGMENT_GLYPHS.length] ?? '0',
      };
    });
  });
}

const TITLE_PARTICLES = buildTitleParticles();

interface CanvasMetrics {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly lines: readonly {
    readonly top: number;
    readonly right: number;
    readonly width: number;
    readonly height: number;
  }[];
}

function syncCanvas(canvas: HTMLCanvasElement, title: HTMLHeadingElement): CanvasMetrics | null {
  const hero = title.closest<HTMLElement>('.idle-hero');
  if (hero === null) return null;
  const titleRect = title.getBoundingClientRect();
  const heroRect = hero.getBoundingClientRect();
  const width = Math.max(1, heroRect.right - titleRect.left);
  const height = Math.max(1, titleRect.height);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  const lines = Array.from(title.querySelectorAll<HTMLElement>('.title-line')).map((line) => {
    const rect = line.getBoundingClientRect();
    return {
      top: rect.top - titleRect.top,
      right: rect.right - titleRect.left,
      width: rect.width,
      height: rect.height,
    };
  });
  return { width, height, pixelRatio, lines };
}

function drawTitleParticles(
  context: CanvasRenderingContext2D,
  metrics: CanvasMetrics,
  elapsedMs: number,
) {
  const { width, height, pixelRatio, lines } = metrics;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#0a0a0a';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const time = elapsedMs / 1000;

  for (const lineIndex of [0, 1, 2] as const) {
    const line = lines[lineIndex];
    if (line === undefined) continue;
    const startX = particleStartX(line.right, line.width);
    const tailLength = Math.max(1, width - startX);
    for (const sizeIndex of [0, 1, 2] as const) {
      const fontSize = particleFontSize(line.height, sizeIndex);
      context.font = `${fontSize}px "League Gothic", Impact, sans-serif`;
      for (const particle of TITLE_PARTICLES) {
        if (particle.lineIndex !== lineIndex || particle.sizeIndex !== sizeIndex) continue;
        const flowProgress = particleFlowProgress(particle.progress, particle.driftX, time);
        const path = particlePath(lineIndex, flowProgress);
        const pulse = Math.sin(time * (0.72 + sizeIndex * 0.11) + particle.phase);
        const crossPulse = Math.cos(time * (0.58 + lineIndex * 0.09) + particle.phase * 1.17);
        const particleDistance = flowProgress * tailLength;
        const x = startX
          + particleDistance
          + pulse * particle.driftX * (1.8 + flowProgress * 3.4);
        const y = line.top
          + particleVerticalOffset(lineIndex, flowProgress, particleDistance, line.height)
          + particle.verticalNoise * path.spread * 0.5 * line.height
          + crossPulse * particle.driftY * (1.6 + flowProgress * 3);
        const flowAlpha = (0.95 - flowProgress * 0.45) * particleFlowOpacity(flowProgress);
        context.globalAlpha = (0.22 + particle.opacity * 0.78) * flowAlpha * (0.92 + pulse * 0.08);
        context.fillText(particle.glyph, x, y);
      }
    }
  }
  context.globalAlpha = 1;
}

export function DissolveTitle() {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const title = titleRef.current;
    const canvas = canvasRef.current;
    if (title === null || canvas === null) return undefined;
    const context = canvas.getContext('2d');
    if (context === null) return undefined;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let metrics = syncCanvas(canvas, title);
    let frame = 0;
    let lastPaint = 0;
    let visible = !document.hidden;

    const paint = (time: number) => {
      frame = 0;
      if (metrics !== null && (lastPaint === 0 || time - lastPaint >= FRAME_INTERVAL_MS)) {
        drawTitleParticles(context, metrics, reducedMotion.matches ? 0 : time);
        lastPaint = time;
      }
      if (visible && !reducedMotion.matches) frame = window.requestAnimationFrame(paint);
    };
    const requestPaint = () => {
      if (frame === 0 && visible) frame = window.requestAnimationFrame(paint);
    };
    const resize = () => {
      metrics = syncCanvas(canvas, title);
      lastPaint = 0;
      requestPaint();
    };
    const handleVisibility = () => {
      visible = !document.hidden;
      if (!visible && frame !== 0) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      } else {
        requestPaint();
      }
    };
    const handleMotion = () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      frame = 0;
      lastPaint = 0;
      requestPaint();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(title);
    const hero = title.closest<HTMLElement>('.idle-hero');
    if (hero !== null) observer.observe(hero);
    document.addEventListener('visibilitychange', handleVisibility);
    reducedMotion.addEventListener('change', handleMotion);
    void document.fonts.ready.then(resize);
    requestPaint();

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
      reducedMotion.removeEventListener('change', handleMotion);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <h1 className="display-title" ref={titleRef}>
      {TITLE_WORDS.map((word) => (
        <span className="title-line" data-word={word.toLowerCase()} key={word}>
          <span className="title-word">{word}</span>
        </span>
      ))}
      <canvas
        className="title-particle-canvas"
        data-particle-count={TITLE_PARTICLES.length}
        ref={canvasRef}
        aria-hidden="true"
      />
    </h1>
  );
}
