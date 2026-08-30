import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
  DEPLOYMENT_MODE,
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

  it('maps only the exact Vite online mode to the online deployment', async () => {
    const source = await readFile(
      new URL('../../src/runtime/deployment.ts', import.meta.url),
      'utf8',
    );

    expect(source).toMatch(
      /DEPLOYMENT_MODE:\s*DeploymentMode\s*=\s*import\.meta\.env\.MODE\s*===\s*'online'\s*\?\s*'online'\s*:\s*'local'/,
    );
  });
});
