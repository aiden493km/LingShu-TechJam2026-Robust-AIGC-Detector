import type { CSSProperties } from 'react';

const SIGNAL = 'B2NJR01AIGC384FP32LOCAL';
const PARTICLE_COUNT = 320;

interface SignalStyle extends CSSProperties {
  readonly '--i': number;
  readonly '--x': string;
  readonly '--y': string;
  readonly '--r': string;
  readonly '--delay': string;
  readonly '--scale': number;
}

function styleFor(index: number): SignalStyle {
  return {
    '--i': index,
    '--x': `${(index * 37 + 11) % 101}%`,
    '--y': `${(index * 53 + 7) % 97}%`,
    '--r': `${((index * 29) % 58) - 29}deg`,
    '--delay': `${-((index * 71) % 3200)}ms`,
    '--scale': 0.62 + ((index * 17) % 58) / 100,
  };
}

export function SignalField() {
  return (
    <span className="signal-field" aria-hidden="true">
      {Array.from({ length: PARTICLE_COUNT }, (_, index) => (
        <i key={index} style={styleFor(index)}>
          {SIGNAL[index % SIGNAL.length]}
        </i>
      ))}
    </span>
  );
}
