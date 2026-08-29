import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  EXPECTED_SOURCE_ORDER,
  MAX_ERROR_LIMIT,
  MEAN_ERROR_LIMIT,
  assessParityRun,
  generateParityReferences,
  loadAndValidateParityManifest,
  selectPythonInterpreter,
} from '../../tools/run_preprocess_parity.mjs';

const TENSOR_FLOAT_COUNT = 442_368;
const TENSOR_BYTES = TENSOR_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT;
const TENSOR_SHAPE = [1, 3, 384, 384];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function imageId(source) {
  return source.replace(/\.[^/.]+$/u, '').split('/').join('__');
}

async function createManifestTree() {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'lingshu-parity-'));
  const parityRoot = path.join(repositoryRoot, 'web_demo', '.generated-tests', 'parity');
  const modelSource = 'web_demo/models/baseline2_njr_fp32.onnx';
  const modelBytes = Buffer.from('model');
  const tensorBytes = Buffer.alloc(TENSOR_BYTES);

  await mkdir(path.join(parityRoot, 'tensors'), { recursive: true });
  await mkdir(path.dirname(path.join(repositoryRoot, modelSource)), { recursive: true });
  await writeFile(path.join(repositoryRoot, modelSource), modelBytes);

  const images = [];
  for (const source of EXPECTED_SOURCE_ORDER) {
    const id = imageId(source);
    const reference = `tensors/${id}.f32`;
    await mkdir(path.dirname(path.join(repositoryRoot, source)), { recursive: true });
    await writeFile(path.join(repositoryRoot, source), Buffer.from(id));
    await writeFile(path.join(parityRoot, ...reference.split('/')), tensorBytes);
    images.push({
      id,
      source,
      reference,
      original_dimensions: { width: 1, height: 1 },
      oriented_dimensions: { width: 1, height: 1 },
      tensor: {
        shape: TENSOR_SHAPE,
        float_count: TENSOR_FLOAT_COUNT,
        bytes: TENSOR_BYTES,
        sha256: sha256(tensorBytes),
      },
      logit: 0,
      probability: 0.5,
      label: 'Real',
    });
  }

  const manifest = {
    schema_version: 1,
    preprocessing: 'inference.preprocess_image',
    tensor: {
      shape: TENSOR_SHAPE,
      dtype: 'float32',
      byte_order: 'little-endian',
      layout: 'NCHW',
      float_count: TENSOR_FLOAT_COUNT,
      bytes: TENSOR_BYTES,
    },
    model: {
      source: modelSource,
      file: 'baseline2_njr_fp32.onnx',
      bytes: modelBytes.length,
      sha256: sha256(modelBytes),
      input_name: 'input',
      output_name: 'logits',
    },
    threshold: 0.55657113,
    images,
  };
  const manifestPath = path.join(parityRoot, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
  return { repositoryRoot, parityRoot, manifestPath, manifest };
}

function passingResults(manifest) {
  return manifest.images.map((image) => ({
    id: image.id,
    floatCount: TENSOR_FLOAT_COUNT,
    meanAbsoluteError: MEAN_ERROR_LIMIT,
    maxAbsoluteError: MAX_ERROR_LIMIT,
    originalDimensions: image.original_dimensions,
    orientedDimensions: image.oriented_dimensions,
    dimensionsMatch: true,
    rgbaHiddenRgbPreserved: image.source.endsWith('rgba-hidden-rgb.png') ? true : null,
    failures: [],
  }));
}

test('validates the frozen schema, path containment, hashes, and image order', async (context) => {
  const fixture = await createManifestTree();
  context.after(() => rm(fixture.repositoryRoot, { recursive: true, force: true }));

  const validated = await loadAndValidateParityManifest({
    repositoryRoot: fixture.repositoryRoot,
    manifestPath: fixture.manifestPath,
  });

  assert.deepEqual(
    validated.images.map((image) => image.source),
    EXPECTED_SOURCE_ORDER,
  );
  assert.equal(validated.images.length, 15);
  assert.equal(validated.tensor.float_count, TENSOR_FLOAT_COUNT);
});

test('rejects reordered images, escaping references, and mismatched reference hashes', async (context) => {
  const fixture = await createManifestTree();
  context.after(() => rm(fixture.repositoryRoot, { recursive: true, force: true }));

  const reordered = structuredClone(fixture.manifest);
  [reordered.images[0], reordered.images[1]] = [reordered.images[1], reordered.images[0]];
  await writeFile(fixture.manifestPath, JSON.stringify(reordered), 'utf8');
  await assert.rejects(
    loadAndValidateParityManifest(fixture),
    /frozen image order/u,
  );

  const escaping = structuredClone(fixture.manifest);
  escaping.images[0].reference = '../outside.f32';
  await writeFile(fixture.manifestPath, JSON.stringify(escaping), 'utf8');
  await assert.rejects(
    loadAndValidateParityManifest(fixture),
    /reference path/u,
  );

  const wrongHash = structuredClone(fixture.manifest);
  wrongHash.images[0].tensor.sha256 = '0'.repeat(64);
  await writeFile(fixture.manifestPath, JSON.stringify(wrongHash), 'utf8');
  await assert.rejects(
    loadAndValidateParityManifest(fixture),
    /SHA-256/u,
  );
});

test('enforces count, fixed tensor limits, EXIF dimensions, RGBA hidden RGB, and local requests', async (context) => {
  const fixture = await createManifestTree();
  context.after(() => rm(fixture.repositoryRoot, { recursive: true, force: true }));
  const results = passingResults(fixture.manifest);

  assert.equal(
    assessParityRun({ manifest: fixture.manifest, results, blockedRequests: [] }).passed,
    true,
  );

  const overMean = structuredClone(results);
  overMean[0].meanAbsoluteError = MEAN_ERROR_LIMIT + Number.EPSILON;
  assert.match(
    assessParityRun({ manifest: fixture.manifest, results: overMean, blockedRequests: [] })
      .failures.join('\n'),
    /mean absolute error/u,
  );

  const overMax = structuredClone(results);
  overMax[0].maxAbsoluteError = MAX_ERROR_LIMIT + Number.EPSILON;
  assert.match(
    assessParityRun({ manifest: fixture.manifest, results: overMax, blockedRequests: [] })
      .failures.join('\n'),
    /maximum absolute error/u,
  );

  const exifMismatch = structuredClone(results);
  exifMismatch[10].dimensionsMatch = false;
  assert.match(
    assessParityRun({ manifest: fixture.manifest, results: exifMismatch, blockedRequests: [] })
      .failures.join('\n'),
    /EXIF oriented dimensions/u,
  );

  const rgbaComposited = structuredClone(results);
  rgbaComposited[14].rgbaHiddenRgbPreserved = false;
  assert.match(
    assessParityRun({ manifest: fixture.manifest, results: rgbaComposited, blockedRequests: [] })
      .failures.join('\n'),
    /RGBA hidden RGB/u,
  );

  const incomplete = results.slice(0, -1);
  assert.match(
    assessParityRun({ manifest: fixture.manifest, results: incomplete, blockedRequests: [] })
      .failures.join('\n'),
    /15\/15/u,
  );

  assert.match(
    assessParityRun({
      manifest: fixture.manifest,
      results,
      blockedRequests: ['https://example.com/tracker.js'],
    }).failures.join('\n'),
    /non-local request/u,
  );
});

test('selects repository Python first, then py -3, with hidden child windows', async () => {
  const repositoryRoot = path.resolve('C:/workspace/repository');
  const calls = [];
  const runProcess = async (command, args, options) => {
    calls.push({ command, args, options });
    if (calls.length === 1) {
      return { exitCode: 103, stdout: '', stderr: 'venv unavailable' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  };

  const selected = await selectPythonInterpreter({ repositoryRoot, runProcess });

  const expectedVenv =
    process.platform === 'win32'
      ? path.join(repositoryRoot, '.venv', 'Scripts', 'python.exe')
      : path.join(repositoryRoot, '.venv', 'bin', 'python');
  assert.equal(calls[0].command, expectedVenv);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[1].command, 'py');
  assert.deepEqual(calls[1].args.slice(0, 2), ['-3', '-c']);
  assert.equal(calls[1].options.windowsHide, true);
  assert.deepEqual(selected, { command: 'py', argumentPrefix: ['-3'] });
});

test('reports generator failure without silently trying another interpreter', async () => {
  const repositoryRoot = path.resolve('C:/workspace/repository');
  const calls = [];
  const runProcess = async (command, args, options) => {
    calls.push({ command, args, options });
    if (calls.length === 1) {
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    return { exitCode: 7, stdout: 'partial output', stderr: 'generation failed' };
  };

  await assert.rejects(
    generateParityReferences({ repositoryRoot, runProcess }),
    /generator exited with code 7.*generation failed/u,
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.windowsHide, true);
  assert.equal(calls[1].options.cwd, repositoryRoot);
  assert.match(calls[1].args.join(' '), /generate_parity_references\.py/u);
});
