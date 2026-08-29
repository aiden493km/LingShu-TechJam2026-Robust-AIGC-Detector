import { FROZEN_THRESHOLD } from './contract';

export type DetectionLabel = 'Real' | 'AIGC';

export function sigmoid(logit: number): number {
  if (!Number.isFinite(logit)) {
    throw new RangeError(`Expected a finite logit; received ${String(logit)}`);
  }

  if (logit >= 0) {
    const exponent = Math.exp(-logit);
    return 1 / (1 + exponent);
  }

  const exponent = Math.exp(logit);
  return exponent / (1 + exponent);
}

export function classifyProbability(probability: number): DetectionLabel {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError(
      `Expected probability in [0, 1]; received ${String(probability)}`,
    );
  }

  return probability >= FROZEN_THRESHOLD ? 'AIGC' : 'Real';
}
