import { describe, expect, it } from 'vitest';

import {
  DEPLOYMENT_MODE,
  deploymentModeFromViteMode,
  modelDeliveryCopy,
} from '../../src/runtime/deployment';

describe('deployment model delivery copy', () => {
  it('keeps the frozen local release wording', () => {
    expect(modelDeliveryCopy('local')).toEqual({
      title: 'LOADING LOCAL MODEL',
      detail: 'Verifying and preparing the local FP32 session.',
      progressLabel: 'Local FP32 model loading progress',
    });
  });

  it('explains the browser download and verification in online mode', () => {
    expect(modelDeliveryCopy('online')).toEqual({
      title: 'DOWNLOADING MODEL',
      detail: 'Downloading and verifying the frozen FP32 model in this browser.',
      progressLabel: 'FP32 model download progress',
    });
  });

  it('defaults the Vitest mode to the local release', () => {
    expect(import.meta.env.MODE).toBe('test');
    expect(DEPLOYMENT_MODE).toBe('local');
  });

  it('maps only the Vite online mode to the online deployment', () => {
    expect(deploymentModeFromViteMode('online')).toBe('online');
    expect(
      ['production', 'test', 'development'].map(deploymentModeFromViteMode),
    ).toEqual(['local', 'local', 'local']);
  });
});
