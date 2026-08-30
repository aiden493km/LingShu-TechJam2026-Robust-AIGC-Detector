import type { DetectorState } from '../detector/machine';

export type DetectorPresentation = 'idle' | 'analysis';

export function detectorPresentation(phase: DetectorState['phase']): DetectorPresentation {
  switch (phase) {
    case 'validating':
    case 'preprocessing':
    case 'inferring':
    case 'success':
      return 'analysis';
    case 'booting':
    case 'ready':
    case 'error':
      return 'idle';
  }
}

export function formatConfidence(probability: number): string {
  return probability.toFixed(8);
}
