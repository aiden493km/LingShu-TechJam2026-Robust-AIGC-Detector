import { formatConfidence } from './presentation';
import { RouteLink } from './RouteLink';
import type { RecentDetection } from './session-history';

export const FROZEN_THRESHOLD = 0.55657113;
const AXIS_TOP = 6;
const AXIS_BOTTOM = 79;

function thresholdY(value: number) {
  return AXIS_BOTTOM - Math.max(0, Math.min(1, value)) * (AXIS_BOTTOM - AXIS_TOP);
}

export interface DetectorEvidenceProps {
  readonly score: number | undefined;
  readonly recentDetections: readonly RecentDetection[];
}

function thresholdWavePoints() {
  return Array.from({ length: 64 }, (_, index) => {
    const progress = index / 63;
    const x = 35 + progress * 313;
    const envelope = 1.1 + 3.3 * Math.pow(Math.sin(progress * Math.PI * 3.6), 2);
    const wave = Math.sin(progress * Math.PI * 15.5) * envelope
      + Math.sin(progress * Math.PI * 5.2 + 0.8) * 1.2;
    const waveformValue = 0.5 + wave * 0.012 * Math.pow(1 - progress, 0.35);
    const value = waveformValue + (FROZEN_THRESHOLD - waveformValue) * Math.pow(progress, 7);
    return { x, y: thresholdY(value) };
  });
}

function svgPath(points: readonly { readonly x: number; readonly y: number }[]) {
  return points.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
}

function ThresholdWaveform({ score }: { readonly score: number | undefined }) {
  const points = thresholdWavePoints();
  const endpoint = points.at(-1) ?? { x: 348, y: thresholdY(FROZEN_THRESHOLD) };
  const scoreX = score === undefined ? undefined : 35 + Math.max(0, Math.min(1, score)) * 313;
  const midpointY = thresholdY(0.5);
  return (
    <div className="threshold-figure">
      <svg className="threshold-waveform" viewBox="0 0 360 86" role="img" aria-label="Frozen threshold waveform from 0.0 to 1.0">
        <g className="threshold-axes" aria-hidden="true">
          <line x1="31" y1="6" x2="31" y2="79" />
          <line x1="27" y1="6" x2="35" y2="6" />
          <line x1="27" y1={midpointY} x2="35" y2={midpointY} />
          <line x1="27" y1="79" x2="35" y2="79" />
          <text x="0" y="9">1.0</text>
          <text x="0" y={midpointY + 3}>0.5</text>
          <text x="0" y="82">0.0</text>
        </g>
        <line className="threshold-reference-line" x1="31" y1={midpointY} x2="348" y2={midpointY} aria-hidden="true" />
        <path className="threshold-wave-line" d={svgPath(points)} aria-hidden="true" />
        <circle className="threshold-endpoint" cx={endpoint.x} cy={endpoint.y} r="3.2" aria-hidden="true" />
        {scoreX === undefined ? null : <circle className="threshold-score" cx={scoreX} cy="79" r="2.2" aria-hidden="true" />}
      </svg>
      {score === undefined ? null : (
        <span className="sr-only">Current AIGC score {formatConfidence(score)}</span>
      )}
    </div>
  );
}

function protocolCenter(progress: number) {
  return 36
    + Math.sin(progress * Math.PI * 5.4 + 0.28) * 7.5
    + Math.sin(progress * Math.PI * 2.1) * 4.2;
}

function protocolCloudPoints() {
  return Array.from({ length: 520 }, (_, index) => {
    const progress = index / 519;
    const x = 7 + progress * 346;
    const lobe = Math.pow(Math.sin(progress * Math.PI * 3.1), 2);
    const spread = 4 + lobe * 19 + Math.pow(Math.sin(progress * Math.PI * 5.2), 2) * 6;
    const noise = (((index * 73 + Math.floor(index / 7) * 29) % 211) / 210 - 0.5) * 2;
    return {
      x,
      y: protocolCenter(progress) + noise * spread,
      radius: 0.45 + ((index * 17) % 7) * 0.09,
      opacity: 0.3 + ((index * 31) % 61) / 100,
    };
  });
}

function ProtocolSignal() {
  const centerline = Array.from({ length: 80 }, (_, index) => {
    const progress = index / 79;
    return { x: 7 + progress * 346, y: protocolCenter(progress) };
  });
  const points = protocolCloudPoints();
  return (
    <svg className="protocol-curve-cloud" viewBox="0 0 360 100" role="img" aria-label="Curved NJR robustness protocol distribution across fourteen fixed conditions">
      <path className="protocol-centerline" d={svgPath(centerline)} aria-hidden="true" />
      {[0, 1, 2].map((band) => (
        <g className={`protocol-particle-band band-${String.fromCharCode(97 + band)}`} aria-hidden="true" key={band}>
          {points.map((point, index) => index % 3 === band ? (
            <circle key={index} cx={point.x} cy={point.y} r={point.radius} opacity={point.opacity} />
          ) : null)}
        </g>
      ))}
    </svg>
  );
}

function RecentImages({ detections }: { readonly detections: readonly RecentDetection[] }) {
  return (
    <>
      <p>{detections.length === 0 ? 'No images in this session' : `${detections.length} ${detections.length === 1 ? 'image' : 'images'} this session`}</p>
      <div className="recent-slots" aria-label="Recent successful detections">
        {Array.from({ length: 3 }, (_, index) => {
          const detection = detections[index];
          if (detection === undefined) {
            return <span className="recent-empty-slot" key={`empty-${index}`} aria-hidden="true" />;
          }
          const details = `${detection.fileName} · ${detection.label} · ${formatConfidence(detection.confidence)}`;
          return (
            <figure className="recent-thumbnail" key={detection.id} title={details}>
              <img src={detection.thumbnailUrl} alt={details} />
              <figcaption className={`recent-verdict is-${detection.label.toLowerCase()}`}>
                {detection.label.toUpperCase()}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </>
  );
}

export function DetectorEvidence({ score, recentDetections }: DetectorEvidenceProps) {
  return (
    <section className="evidence-strip" aria-label="Detector quick reference">
      <article className="evidence-block threshold-block">
        <h2>FROZEN THRESHOLD</h2>
        <p className="evidence-value">{FROZEN_THRESHOLD}</p>
        <ThresholdWaveform score={score} />
      </article>
      <article className="evidence-block protocol-block">
        <h2>ROBUSTNESS PROTOCOL</h2>
        <p className="evidence-value">NJR · 14 FIXED CONDITIONS</p>
        <ProtocolSignal />
      </article>
      <article className="evidence-block recent-block">
        <h2>RECENT IMAGES</h2>
        <RecentImages detections={recentDetections} />
      </article>
      <article className="evidence-block notes-block">
        <h2>TECHNICAL NOTES</h2>
        <p>Preprocess locally. Infer locally.</p>
        <p>Keep image bytes in memory.</p>
        <RouteLink className="read-link" href="#/technology">READ NOTES <span aria-hidden="true">→</span></RouteLink>
      </article>
    </section>
  );
}
