export const MODEL_FILE = 'baseline2_njr_fp32.onnx' as const;
export const MODEL_BYTES = 88_123_029 as const;
export const MODEL_SHA256 =
  'e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69' as const;
export const FROZEN_THRESHOLD = 0.55657113 as const;

export interface ModelManifest {
  readonly schema_version: 1;
  readonly model: {
    readonly file: typeof MODEL_FILE;
    readonly bytes: typeof MODEL_BYTES;
    readonly sha256: typeof MODEL_SHA256;
    readonly format: 'ONNX';
    readonly precision: 'FP32';
    readonly opset: 18;
    readonly input: {
      readonly name: 'input';
      readonly dtype: 'float32';
      readonly shape: readonly [1, 3, 384, 384];
    };
    readonly output: {
      readonly name: 'logits';
      readonly dtype: 'float32';
      readonly shape: readonly [1, 1];
    };
  };
  readonly source: {
    readonly release_name: 'v1.0.0 — Final B2-NJR Checkpoint';
    readonly tag: 'v1.0.0';
    readonly checkpoint: {
      readonly file: 'baseline2_njr_best.pt';
      readonly bytes: 87_312_599;
      readonly sha256: '9348c210f1612b4c78d74dde5e717b69e90274cbbf6fa60c4b893946409658ba';
    };
    readonly exporter: {
      readonly script: 'web_model_experiment.py';
      readonly commit: 'c9ceb2e';
    };
  };
  readonly threshold: {
    readonly aigc: typeof FROZEN_THRESHOLD;
    readonly decision_rule: 'probability >= threshold => AIGC';
  };
  readonly preprocessing: {
    readonly order: readonly [
      'exif_transpose',
      'rgb',
      'bicubic_384',
      'to_tensor',
      'imagenet_normalize',
    ];
    readonly resize: {
      readonly width: 384;
      readonly height: 384;
      readonly filter: 'Catmull-Rom bicubic';
      readonly fit: 'stretch';
    };
    readonly channel_order: 'CHW RGB';
    readonly scale: 'uint8 / 255';
    readonly mean: readonly [0.485, 0.456, 0.406];
    readonly std: readonly [0.229, 0.224, 0.225];
  };
}

export class ModelContractError extends Error {
  override readonly name = 'ModelContractError';
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function expectObject(value: unknown, path: string): JsonObject {
  if (!isJsonObject(value)) {
    throw new ModelContractError(`${path} must be a JSON object; received ${describe(value)}`);
  }
  return value;
}

function expectKeys(value: JsonObject, keys: readonly string[], path: string): void {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new ModelContractError(`${path} is missing required field ${JSON.stringify(key)}`);
    }
  }

  const unexpected = Object.keys(value).find((key) => !keys.includes(key));
  if (unexpected !== undefined) {
    throw new ModelContractError(
      `${path} has unexpected field ${JSON.stringify(unexpected)}; remove unsupported variants`,
    );
  }
}

function expectLiteral<T extends string | number>(
  value: unknown,
  expected: T,
  path: string,
): void {
  if (value !== expected) {
    throw new ModelContractError(
      `${path} must equal ${describe(expected)}; received ${describe(value)}`,
    );
  }
}

function expectFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ModelContractError(`${path} must be a finite number; received ${describe(value)}`);
  }
  return value;
}

function expectFiniteLiteral(value: unknown, expected: number, path: string): void {
  const number = expectFiniteNumber(value, path);
  expectLiteral(number, expected, path);
}

function expectSha256(value: unknown, expected: string, path: string): void {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new ModelContractError(
      `${path} must be a 64-character lowercase SHA-256 digest; received ${describe(value)}`,
    );
  }
  expectLiteral(value, expected, path);
}

function expectExactNumberArray(
  value: unknown,
  expected: readonly number[],
  path: string,
): void {
  if (!Array.isArray(value)) {
    throw new ModelContractError(
      `${path} must exactly equal ${describe(expected)}; received ${describe(value)}`,
    );
  }
  for (const [index, item] of value.entries()) {
    expectFiniteNumber(item, `${path}[${index}]`);
  }
  if (
    value.length !== expected.length ||
    value.some((item, index) => item !== expected[index])
  ) {
    throw new ModelContractError(
      `${path} must exactly equal ${describe(expected)}; received ${describe(value)}`,
    );
  }
}

function expectExactStringArray(
  value: unknown,
  expected: readonly string[],
  path: string,
): void {
  if (
    !Array.isArray(value) ||
    value.length !== expected.length ||
    expected.some(
      (item, index) =>
        !Object.prototype.hasOwnProperty.call(value, index) || value[index] !== item,
    )
  ) {
    throw new ModelContractError(
      `${path} must exactly equal ${describe(expected)}; received ${describe(value)}`,
    );
  }
}

export function parseModelManifest(value: unknown): ModelManifest {
  const manifest = expectObject(value, 'manifest');
  expectKeys(manifest, ['schema_version', 'model', 'source', 'threshold', 'preprocessing'], 'manifest');
  expectFiniteLiteral(manifest.schema_version, 1, 'manifest.schema_version');

  const model = expectObject(manifest.model, 'model');
  expectKeys(
    model,
    ['file', 'bytes', 'sha256', 'format', 'precision', 'opset', 'input', 'output'],
    'model',
  );
  expectLiteral(model.file, MODEL_FILE, 'model.file');
  expectFiniteLiteral(model.bytes, MODEL_BYTES, 'model.bytes');
  expectSha256(model.sha256, MODEL_SHA256, 'model.sha256');
  expectLiteral(model.format, 'ONNX', 'model.format');
  expectLiteral(model.precision, 'FP32', 'model.precision');
  expectFiniteLiteral(model.opset, 18, 'model.opset');

  const input = expectObject(model.input, 'model.input');
  expectKeys(input, ['name', 'dtype', 'shape'], 'model.input');
  expectLiteral(input.name, 'input', 'model.input.name');
  expectLiteral(input.dtype, 'float32', 'model.input.dtype');
  expectExactNumberArray(input.shape, [1, 3, 384, 384], 'model.input.shape');

  const output = expectObject(model.output, 'model.output');
  expectKeys(output, ['name', 'dtype', 'shape'], 'model.output');
  expectLiteral(output.name, 'logits', 'model.output.name');
  expectLiteral(output.dtype, 'float32', 'model.output.dtype');
  expectExactNumberArray(output.shape, [1, 1], 'model.output.shape');

  const source = expectObject(manifest.source, 'source');
  expectKeys(source, ['release_name', 'tag', 'checkpoint', 'exporter'], 'source');
  expectLiteral(
    source.release_name,
    'v1.0.0 — Final B2-NJR Checkpoint',
    'source.release_name',
  );
  expectLiteral(source.tag, 'v1.0.0', 'source.tag');

  const checkpoint = expectObject(source.checkpoint, 'source.checkpoint');
  expectKeys(checkpoint, ['file', 'bytes', 'sha256'], 'source.checkpoint');
  expectLiteral(checkpoint.file, 'baseline2_njr_best.pt', 'source.checkpoint.file');
  expectFiniteLiteral(checkpoint.bytes, 87_312_599, 'source.checkpoint.bytes');
  expectSha256(
    checkpoint.sha256,
    '9348c210f1612b4c78d74dde5e717b69e90274cbbf6fa60c4b893946409658ba',
    'source.checkpoint.sha256',
  );

  const exporter = expectObject(source.exporter, 'source.exporter');
  expectKeys(exporter, ['script', 'commit'], 'source.exporter');
  expectLiteral(exporter.script, 'web_model_experiment.py', 'source.exporter.script');
  expectLiteral(exporter.commit, 'c9ceb2e', 'source.exporter.commit');

  const threshold = expectObject(manifest.threshold, 'threshold');
  expectKeys(threshold, ['aigc', 'decision_rule'], 'threshold');
  const thresholdValue = expectFiniteNumber(threshold.aigc, 'threshold.aigc');
  if (thresholdValue < 0 || thresholdValue > 1) {
    throw new ModelContractError(
      `threshold.aigc must be in [0, 1]; received ${describe(thresholdValue)}`,
    );
  }
  expectLiteral(thresholdValue, FROZEN_THRESHOLD, 'threshold.aigc');
  expectLiteral(
    threshold.decision_rule,
    'probability >= threshold => AIGC',
    'threshold.decision_rule',
  );

  const preprocessing = expectObject(manifest.preprocessing, 'preprocessing');
  expectKeys(
    preprocessing,
    ['order', 'resize', 'channel_order', 'scale', 'mean', 'std'],
    'preprocessing',
  );
  expectExactStringArray(
    preprocessing.order,
    ['exif_transpose', 'rgb', 'bicubic_384', 'to_tensor', 'imagenet_normalize'],
    'preprocessing.order',
  );

  const resize = expectObject(preprocessing.resize, 'preprocessing.resize');
  expectKeys(resize, ['width', 'height', 'filter', 'fit'], 'preprocessing.resize');
  expectFiniteLiteral(resize.width, 384, 'preprocessing.resize.width');
  expectFiniteLiteral(resize.height, 384, 'preprocessing.resize.height');
  expectLiteral(resize.filter, 'Catmull-Rom bicubic', 'preprocessing.resize.filter');
  expectLiteral(resize.fit, 'stretch', 'preprocessing.resize.fit');
  expectLiteral(preprocessing.channel_order, 'CHW RGB', 'preprocessing.channel_order');
  expectLiteral(preprocessing.scale, 'uint8 / 255', 'preprocessing.scale');
  expectExactNumberArray(preprocessing.mean, [0.485, 0.456, 0.406], 'preprocessing.mean');
  expectExactNumberArray(preprocessing.std, [0.229, 0.224, 0.225], 'preprocessing.std');

  return {
    schema_version: 1,
    model: {
      file: MODEL_FILE,
      bytes: MODEL_BYTES,
      sha256: MODEL_SHA256,
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
      aigc: FROZEN_THRESHOLD,
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
}
