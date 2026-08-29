import { describe, expect, it } from 'vitest';
import manifestJson from '../../models/manifest.json';
import {
  FROZEN_THRESHOLD,
  MODEL_BYTES,
  MODEL_FILE,
  MODEL_SHA256,
  ModelContractError,
  parseModelManifest,
} from '../../src/runtime/contract';

const validManifest = {
  schema_version: 1,
  model: {
    file: 'baseline2_njr_fp32.onnx',
    bytes: 88_123_029,
    sha256: 'e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69',
    format: 'ONNX',
    precision: 'FP32',
    opset: 18,
    input: { name: 'input', dtype: 'float32', shape: [1, 3, 384, 384] },
    output: { name: 'logits', dtype: 'float32', shape: [1, 1] },
  },
  source: {
    release_name: 'v1.0.0 — Final B2-NJR Checkpoint',
    tag: 'v1.0.0',
    checkpoint: {
      file: 'baseline2_njr_best.pt',
      bytes: 87_312_599,
      sha256: '9348c210f1612b4c78d74dde5e717b69e90274cbbf6fa60c4b893946409658ba',
    },
    exporter: { script: 'web_model_experiment.py', commit: 'c9ceb2e' },
  },
  threshold: {
    aigc: 0.55657113,
    decision_rule: 'probability >= threshold => AIGC',
  },
  preprocessing: {
    order: [
      'exif_transpose',
      'rgb',
      'bicubic_384',
      'to_tensor',
      'imagenet_normalize',
    ],
    resize: {
      width: 384,
      height: 384,
      filter: 'Catmull-Rom bicubic',
      fit: 'stretch',
    },
    channel_order: 'CHW RGB',
    scale: 'uint8 / 255',
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
  },
};

function mutated(
  update: (manifest: typeof validManifest) => void,
): typeof validManifest {
  const candidate = structuredClone(validManifest);
  update(candidate);
  return candidate;
}

function expectContractError(candidate: unknown, message: RegExp): void {
  expect(() => parseModelManifest(candidate)).toThrow(ModelContractError);
  expect(() => parseModelManifest(candidate)).toThrow(message);
}

describe('frozen model contract', () => {
  it('exports the exact deployed model constants', () => {
    expect(MODEL_FILE).toBe('baseline2_njr_fp32.onnx');
    expect(MODEL_BYTES).toBe(88_123_029);
    expect(MODEL_SHA256).toBe(
      'e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69',
    );
    expect(FROZEN_THRESHOLD).toBe(0.55657113);
  });

  it('accepts the exact schema and constructs a detached result', () => {
    const parsed = parseModelManifest(validManifest);

    expect(parsed).toEqual(validManifest);
    expect(parsed).not.toBe(validManifest);
    expect(parsed.model).not.toBe(validManifest.model);
    expect(parsed.model.input.shape).not.toBe(validManifest.model.input.shape);
    expect(parsed.preprocessing.order).not.toBe(validManifest.preprocessing.order);
    expect(parsed.preprocessing.mean).not.toBe(validManifest.preprocessing.mean);
  });

  it('keeps the checked-in manifest aligned with the frozen contract', () => {
    expect(parseModelManifest(manifestJson)).toEqual(validManifest);
  });

  it('rejects a missing root field and a changed schema version', () => {
    const { source: _source, ...missingSource } = validManifest;
    expectContractError(missingSource, /manifest.*missing.*source/i);
    expectContractError(
      mutated((manifest) => {
        manifest.schema_version = 2;
      }),
      /schema_version.*1/i,
    );
  });

  it('rejects mutations to the deployed model identity', () => {
    expectContractError(
      mutated((manifest) => {
        manifest.model.file = 'other.onnx';
      }),
      /model\.file.*baseline2_njr_fp32\.onnx/i,
    );
    expectContractError(
      mutated((manifest) => {
        manifest.model.bytes = 1;
      }),
      /model\.bytes.*88123029/i,
    );
    expectContractError(
      mutated((manifest) => {
        manifest.model.sha256 = manifest.model.sha256.toUpperCase();
      }),
      /model\.sha256.*lowercase/i,
    );
  });

  it('rejects non-ONNX, alternative precision, and wrong opset models', () => {
    expectContractError(
      mutated((manifest) => {
        manifest.model.format = 'TorchScript';
      }),
      /model\.format.*ONNX/i,
    );
    expectContractError(
      mutated((manifest) => {
        manifest.model.precision = 'FP16';
      }),
      /model\.precision.*FP32/i,
    );
    expectContractError(
      mutated((manifest) => {
        manifest.model.opset = 17;
      }),
      /model\.opset.*18/i,
    );
  });

  it('rejects unexpected alternative precision fields', () => {
    const candidate = structuredClone(validManifest) as typeof validManifest & {
      model: typeof validManifest.model & { fp16_file?: string };
    };
    candidate.model.fp16_file = 'baseline2_njr_fp16.onnx';

    expectContractError(candidate, /model.*unexpected.*fp16_file/i);
  });

  it('rejects input name, dtype, and shape mutations', () => {
    expectContractError(
      mutated((manifest) => {
        manifest.model.input.name = 'images';
      }),
      /model\.input\.name.*input/i,
    );
    expectContractError(
      mutated((manifest) => {
        manifest.model.input.dtype = 'float16';
      }),
      /model\.input\.dtype.*float32/i,
    );
    expectContractError(
      mutated((manifest) => {
        manifest.model.input.shape = [1, 3, 224, 224];
      }),
      /model\.input\.shape.*1,3,384,384/i,
    );
  });

  it('rejects sparse numeric tensor shapes', () => {
    const sparseShape = new Array<number>(4);
    sparseShape[0] = 1;
    sparseShape[2] = 384;
    sparseShape[3] = 384;

    expectContractError(
      mutated((manifest) => {
        manifest.model.input.shape = sparseShape;
      }),
      /model\.input\.shape\[1\].*finite/i,
    );
  });

  it('rejects output name, dtype, and shape mutations', () => {
    expectContractError(
      mutated((manifest) => {
        manifest.model.output.name = 'probability';
      }),
      /model\.output\.name.*logits/i,
    );
    expectContractError(
      mutated((manifest) => {
        manifest.model.output.dtype = 'float64';
      }),
      /model\.output\.dtype.*float32/i,
    );
    expectContractError(
      mutated((manifest) => {
        manifest.model.output.shape = [1, 2];
      }),
      /model\.output\.shape.*1,1/i,
    );
  });

  it('rejects mutations to source checkpoint provenance', () => {
    expectContractError(
      mutated((manifest) => {
        manifest.source.release_name = 'draft';
      }),
      /source\.release_name.*v1\.0\.0/i,
    );
    expectContractError(
      mutated((manifest) => {
        manifest.source.checkpoint.sha256 = '0'.repeat(64);
      }),
      /source\.checkpoint\.sha256.*9348c210/i,
    );
    expectContractError(
      mutated((manifest) => {
        manifest.source.exporter.commit = 'deadbee';
      }),
      /source\.exporter\.commit.*c9ceb2e/i,
    );
  });

  it('rejects non-finite and out-of-range thresholds', () => {
    expectContractError(
      mutated((manifest) => {
        manifest.threshold.aigc = Number.NaN;
      }),
      /threshold\.aigc.*finite/i,
    );
    expectContractError(
      mutated((manifest) => {
        manifest.threshold.aigc = 1.01;
      }),
      /threshold\.aigc.*\[0, 1\]/i,
    );
    expectContractError(
      mutated((manifest) => {
        manifest.threshold.decision_rule = 'probability > threshold => AIGC';
      }),
      /threshold\.decision_rule.*probability >= threshold => AIGC/i,
    );
  });

  it('rejects any preprocessing order change', () => {
    expectContractError(
      mutated((manifest) => {
        manifest.preprocessing.order = [
          'rgb',
          'exif_transpose',
          'bicubic_384',
          'to_tensor',
          'imagenet_normalize',
        ];
      }),
      /preprocessing\.order.*exif_transpose.*rgb.*bicubic_384.*to_tensor.*imagenet_normalize/i,
    );
  });

  it('rejects sparse preprocessing order arrays', () => {
    const sparseOrder = new Array<string>(5);
    sparseOrder[0] = 'exif_transpose';
    sparseOrder[2] = 'bicubic_384';
    sparseOrder[3] = 'to_tensor';
    sparseOrder[4] = 'imagenet_normalize';

    expectContractError(
      mutated((manifest) => {
        manifest.preprocessing.order = sparseOrder;
      }),
      /preprocessing\.order.*exactly equal/i,
    );
  });

  it('rejects mutations to resize, channel, scale, and normalization fields', () => {
    expectContractError(
      mutated((manifest) => {
        manifest.preprocessing.resize.fit = 'cover';
      }),
      /preprocessing\.resize\.fit.*stretch/i,
    );
    expectContractError(
      mutated((manifest) => {
        manifest.preprocessing.channel_order = 'HWC RGB';
      }),
      /preprocessing\.channel_order.*CHW RGB/i,
    );
    expectContractError(
      mutated((manifest) => {
        manifest.preprocessing.scale = 'uint8 / 127.5';
      }),
      /preprocessing\.scale.*uint8 \/ 255/i,
    );
    expectContractError(
      mutated((manifest) => {
        manifest.preprocessing.mean = [0.5, 0.5, 0.5];
      }),
      /preprocessing\.mean.*0\.485,0\.456,0\.406/i,
    );
    expectContractError(
      mutated((manifest) => {
        manifest.preprocessing.std = [0.229, Number.POSITIVE_INFINITY, 0.225];
      }),
      /preprocessing\.std\[1\].*finite/i,
    );
  });
});
