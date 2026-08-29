import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from 'playwright-core';
import { createServer } from 'vite';

export const EXPECTED_SOURCE_ORDER = Object.freeze([
  'demo_images/f1.png',
  'demo_images/f2.png',
  'demo_images/f3.png',
  'demo_images/f4.png',
  'demo_images/f5.png',
  'demo_images/r1.png',
  'demo_images/r2.png',
  'demo_images/r3.png',
  'demo_images/r4.png',
  'demo_images/r5.png',
  'web_demo/tests/fixtures/exif-orientation-6.jpg',
  'web_demo/tests/fixtures/grayscale.png',
  'web_demo/tests/fixtures/near-threshold-synthetic.png',
  'web_demo/tests/fixtures/non-square.png',
  'web_demo/tests/fixtures/rgba-hidden-rgb.png',
]);

export const MEAN_ERROR_LIMIT = 0.02;
export const MAX_ERROR_LIMIT = 0.5;

const TENSOR_SHAPE = Object.freeze([1, 3, 384, 384]);
const TENSOR_FLOAT_COUNT = 442_368;
const TENSOR_BYTES = TENSOR_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT;
const FROZEN_THRESHOLD = 0.55657113;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const RGBA_SOURCE = 'web_demo/tests/fixtures/rgba-hidden-rgb.png';
const EXIF_SOURCE = 'web_demo/tests/fixtures/exif-orientation-6.jpg';
const PYTHON_VERSION_PROBE =
  'import sys; raise SystemExit(sys.version_info < (3, 11))';

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectRecord(value, label) {
  invariant(isRecord(value), `${label} must be an object`);
  return value;
}

function expectExactKeys(value, keys, label) {
  const record = expectRecord(value, label);
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  invariant(
    actual.length === expected.length && actual.every((key, index) => key === expected[index]),
    `${label} keys must be exactly ${expected.join(', ')}`,
  );
  return record;
}

function expectPositiveInteger(value, label) {
  invariant(Number.isSafeInteger(value) && value > 0, `${label} must be a positive integer`);
  return value;
}

function expectFiniteNumber(value, label) {
  invariant(typeof value === 'number' && Number.isFinite(value), `${label} must be finite`);
  return value;
}

function expectString(value, label) {
  invariant(typeof value === 'string' && value.length > 0, `${label} must be a non-empty string`);
  return value;
}

function expectSha256(value, label) {
  const hash = expectString(value, label);
  invariant(SHA256_PATTERN.test(hash), `${label} must be a lowercase SHA-256`);
  return hash;
}

function expectShape(value, label) {
  invariant(
    Array.isArray(value) &&
      value.length === TENSOR_SHAPE.length &&
      value.every((item, index) => item === TENSOR_SHAPE[index]),
    `${label} must be [1,3,384,384]`,
  );
  return [...TENSOR_SHAPE];
}

function expectDimensions(value, label) {
  const dimensions = expectExactKeys(value, ['height', 'width'], label);
  return {
    width: expectPositiveInteger(dimensions.width, `${label}.width`),
    height: expectPositiveInteger(dimensions.height, `${label}.height`),
  };
}

function expectedImageId(source) {
  return source.replace(/\.[^/.]+$/u, '').split('/').join('__');
}

function stableSigmoid(logit) {
  if (logit >= 0) {
    return 1 / (1 + Math.exp(-logit));
  }
  const exponential = Math.exp(logit);
  return exponential / (1 + exponential);
}

function assertContainedPath(root, candidate, label) {
  const relative = path.relative(root, candidate);
  invariant(
    relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    `${label} escapes its allowed root`,
  );
}

function parsePosixRelativePath(value, label) {
  const relative = expectString(value, label);
  invariant(!relative.includes('\\'), `${label} must use POSIX separators`);
  invariant(!path.posix.isAbsolute(relative), `${label} must be repository-relative`);
  const parts = relative.split('/');
  invariant(
    parts.every((part) => part.length > 0 && part !== '.' && part !== '..'),
    `${label} contains an invalid path segment`,
  );
  return { relative, parts };
}

async function resolveRegularFile(root, relativeValue, label) {
  const { relative, parts } = parsePosixRelativePath(relativeValue, label);
  const candidate = path.resolve(root, ...parts);
  assertContainedPath(root, candidate, label);
  const metadata = await lstat(candidate).catch(() => null);
  invariant(metadata?.isFile() === true && !metadata.isSymbolicLink(), `${label} is not a regular file`);
  const resolvedRoot = await realpath(root);
  const resolvedCandidate = await realpath(candidate);
  assertContainedPath(resolvedRoot, resolvedCandidate, label);
  return { relative, path: resolvedCandidate, bytes: metadata.size };
}

async function sha256File(filePath) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    digest.update(chunk);
  }
  return digest.digest('hex');
}

function runChildProcess(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout?.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.once('error', (error) => {
      resolve({
        exitCode: null,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: error.message,
      });
    });
    child.once('close', (exitCode, signal) => {
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr:
          Buffer.concat(stderr).toString('utf8') ||
          (signal ? `process terminated by signal ${signal}` : ''),
      });
    });
  });
}

export async function selectPythonInterpreter({
  repositoryRoot,
  runProcess = runChildProcess,
}) {
  const venvPython =
    process.platform === 'win32'
      ? path.join(repositoryRoot, '.venv', 'Scripts', 'python.exe')
      : path.join(repositoryRoot, '.venv', 'bin', 'python');
  const candidates = [
    { command: venvPython, argumentPrefix: [] },
    { command: 'py', argumentPrefix: ['-3'] },
    { command: 'python3', argumentPrefix: [] },
    { command: 'python', argumentPrefix: [] },
  ];
  const diagnostics = [];

  for (const candidate of candidates) {
    const result = await runProcess(
      candidate.command,
      [...candidate.argumentPrefix, '-c', PYTHON_VERSION_PROBE],
      { cwd: repositoryRoot, windowsHide: true },
    );
    if (result.exitCode === 0) {
      return candidate;
    }
    diagnostics.push(
      `${candidate.command}${candidate.argumentPrefix.length > 0 ? ` ${candidate.argumentPrefix.join(' ')}` : ''}: ${result.stderr || `exit ${String(result.exitCode)}`}`,
    );
  }

  throw new Error(
    `Python 3.11+ is required to generate preprocessing references. ${diagnostics.join(' | ')}`,
  );
}

export async function generateParityReferences({
  repositoryRoot,
  runProcess = runChildProcess,
}) {
  const selected = await selectPythonInterpreter({ repositoryRoot, runProcess });
  const generatorPath = path.join(
    repositoryRoot,
    'web_demo',
    'tools',
    'generate_parity_references.py',
  );
  const result = await runProcess(
    selected.command,
    [
      ...selected.argumentPrefix,
      generatorPath,
      '--repository-root',
      repositoryRoot,
      '--output',
      'web_demo/.generated-tests/parity',
    ],
    { cwd: repositoryRoot, windowsHide: true },
  );
  if (result.exitCode !== 0) {
    const diagnostic = result.stderr.trim() || result.stdout.trim() || 'no diagnostic output';
    throw new Error(
      `Parity reference generator exited with code ${String(result.exitCode)}: ${diagnostic}`,
    );
  }
  return {
    interpreter: {
      command: selected.command,
      argumentPrefix: [...selected.argumentPrefix],
    },
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function validateFileIdentity(file, expectedBytes, expectedSha256, label) {
  invariant(file.bytes === expectedBytes, `${label} byte count mismatch`);
  const observedSha256 = await sha256File(file.path);
  invariant(observedSha256 === expectedSha256, `${label} SHA-256 mismatch`);
}

export async function loadAndValidateParityManifest({ repositoryRoot, manifestPath }) {
  const root = await realpath(path.resolve(repositoryRoot));
  const manifestCandidate = path.resolve(manifestPath);
  assertContainedPath(root, manifestCandidate, 'manifest path');
  const parityRoot = path.dirname(manifestCandidate);
  const manifestMetadata = await lstat(manifestCandidate).catch(() => null);
  invariant(
    manifestMetadata?.isFile() === true && !manifestMetadata.isSymbolicLink(),
    'manifest path is not a regular file',
  );

  let untrusted;
  try {
    untrusted = JSON.parse(await readFile(manifestCandidate, 'utf8'));
  } catch (error) {
    throw new Error(`failed to read parity manifest: ${error instanceof Error ? error.message : String(error)}`);
  }

  const manifest = expectExactKeys(
    untrusted,
    ['images', 'model', 'preprocessing', 'schema_version', 'tensor', 'threshold'],
    'manifest',
  );
  invariant(manifest.schema_version === 1, 'manifest.schema_version must be 1');
  invariant(
    manifest.preprocessing === 'inference.preprocess_image',
    'manifest.preprocessing must identify inference.preprocess_image',
  );
  invariant(manifest.threshold === FROZEN_THRESHOLD, `manifest.threshold must be ${FROZEN_THRESHOLD}`);

  const tensor = expectExactKeys(
    manifest.tensor,
    ['byte_order', 'bytes', 'dtype', 'float_count', 'layout', 'shape'],
    'manifest.tensor',
  );
  expectShape(tensor.shape, 'manifest.tensor.shape');
  invariant(tensor.dtype === 'float32', 'manifest.tensor.dtype must be float32');
  invariant(tensor.byte_order === 'little-endian', 'manifest.tensor.byte_order must be little-endian');
  invariant(tensor.layout === 'NCHW', 'manifest.tensor.layout must be NCHW');
  invariant(tensor.float_count === TENSOR_FLOAT_COUNT, `manifest.tensor.float_count must be ${TENSOR_FLOAT_COUNT}`);
  invariant(tensor.bytes === TENSOR_BYTES, `manifest.tensor.bytes must be ${TENSOR_BYTES}`);

  const model = expectExactKeys(
    manifest.model,
    ['bytes', 'file', 'input_name', 'output_name', 'sha256', 'source'],
    'manifest.model',
  );
  const modelFile = expectString(model.file, 'manifest.model.file');
  invariant(modelFile === 'baseline2_njr_fp32.onnx', 'manifest.model.file must name the frozen FP32 model');
  const modelSource = expectString(model.source, 'manifest.model.source');
  invariant(
    modelSource === `web_demo/models/${modelFile}`,
    'manifest.model.source must identify the deployed model path',
  );
  invariant(model.input_name === 'input', 'manifest.model.input_name must be input');
  invariant(model.output_name === 'logits', 'manifest.model.output_name must be logits');
  const modelBytes = expectPositiveInteger(model.bytes, 'manifest.model.bytes');
  const modelSha256 = expectSha256(model.sha256, 'manifest.model.sha256');
  const resolvedModel = await resolveRegularFile(root, modelSource, 'model source path');
  await validateFileIdentity(resolvedModel, modelBytes, modelSha256, 'model source');

  invariant(Array.isArray(manifest.images), 'manifest.images must be an array');
  invariant(
    manifest.images.length === EXPECTED_SOURCE_ORDER.length,
    `manifest.images must contain exactly ${EXPECTED_SOURCE_ORDER.length} entries`,
  );

  const validatedImages = [];
  for (const [index, expectedSource] of EXPECTED_SOURCE_ORDER.entries()) {
    const row = expectExactKeys(
      manifest.images[index],
      [
        'id',
        'label',
        'logit',
        'oriented_dimensions',
        'original_dimensions',
        'probability',
        'reference',
        'source',
        'tensor',
      ],
      `manifest.images[${index}]`,
    );
    invariant(
      row.source === expectedSource,
      `manifest.images violates the frozen image order at index ${index}: expected ${expectedSource}`,
    );
    const source = expectString(row.source, `manifest.images[${index}].source`);
    const id = expectString(row.id, `manifest.images[${index}].id`);
    invariant(id === expectedImageId(source), `manifest.images[${index}].id does not match its source`);
    const reference = expectString(row.reference, `manifest.images[${index}].reference`);
    invariant(
      reference === `tensors/${id}.f32`,
      `manifest.images[${index}] reference path must be tensors/${id}.f32`,
    );

    const sourceFile = await resolveRegularFile(root, source, `manifest.images[${index}] source path`);
    const referenceFile = await resolveRegularFile(
      parityRoot,
      reference,
      `manifest.images[${index}] reference path`,
    );
    const imageTensor = expectExactKeys(
      row.tensor,
      ['bytes', 'float_count', 'sha256', 'shape'],
      `manifest.images[${index}].tensor`,
    );
    expectShape(imageTensor.shape, `manifest.images[${index}].tensor.shape`);
    invariant(
      imageTensor.float_count === TENSOR_FLOAT_COUNT,
      `manifest.images[${index}].tensor.float_count must be ${TENSOR_FLOAT_COUNT}`,
    );
    invariant(
      imageTensor.bytes === TENSOR_BYTES,
      `manifest.images[${index}].tensor.bytes must be ${TENSOR_BYTES}`,
    );
    const referenceSha256 = expectSha256(
      imageTensor.sha256,
      `manifest.images[${index}].tensor.sha256`,
    );
    await validateFileIdentity(referenceFile, TENSOR_BYTES, referenceSha256, `reference ${id}`);

    const originalDimensions = expectDimensions(
      row.original_dimensions,
      `manifest.images[${index}].original_dimensions`,
    );
    const orientedDimensions = expectDimensions(
      row.oriented_dimensions,
      `manifest.images[${index}].oriented_dimensions`,
    );
    const logit = expectFiniteNumber(row.logit, `manifest.images[${index}].logit`);
    const probability = expectFiniteNumber(
      row.probability,
      `manifest.images[${index}].probability`,
    );
    invariant(probability >= 0 && probability <= 1, `manifest.images[${index}].probability must be in [0,1]`);
    invariant(
      Math.abs(probability - stableSigmoid(logit)) <= 1e-12,
      `manifest.images[${index}].probability does not match its logit`,
    );
    const label = expectString(row.label, `manifest.images[${index}].label`);
    invariant(
      label === (probability >= FROZEN_THRESHOLD ? 'AIGC' : 'Real'),
      `manifest.images[${index}].label does not match the frozen threshold`,
    );

    validatedImages.push({
      id,
      source,
      sourcePath: sourceFile.path,
      reference,
      referencePath: referenceFile.path,
      original_dimensions: originalDimensions,
      oriented_dimensions: orientedDimensions,
      tensor: {
        shape: [...TENSOR_SHAPE],
        float_count: TENSOR_FLOAT_COUNT,
        bytes: TENSOR_BYTES,
        sha256: referenceSha256,
      },
      logit,
      probability,
      label,
    });
  }

  return {
    schema_version: 1,
    preprocessing: 'inference.preprocess_image',
    tensor: {
      shape: [...TENSOR_SHAPE],
      dtype: 'float32',
      byte_order: 'little-endian',
      layout: 'NCHW',
      float_count: TENSOR_FLOAT_COUNT,
      bytes: TENSOR_BYTES,
    },
    model: {
      source: modelSource,
      file: modelFile,
      bytes: modelBytes,
      sha256: modelSha256,
      input_name: 'input',
      output_name: 'logits',
    },
    threshold: FROZEN_THRESHOLD,
    images: validatedImages,
  };
}

export function assessParityRun({ manifest, results, blockedRequests = [], browserErrors = [] }) {
  const failures = [];
  const expectedImages = manifest.images ?? [];
  if (results.length !== EXPECTED_SOURCE_ORDER.length) {
    failures.push(`processed ${results.length}/${EXPECTED_SOURCE_ORDER.length}; required 15/15`);
  }
  if (blockedRequests.length > 0) {
    failures.push(`blocked non-local request(s): ${blockedRequests.join(', ')}`);
  }
  if (browserErrors.length > 0) {
    failures.push(`browser error(s): ${browserErrors.join(' | ')}`);
  }

  let passedCount = 0;
  for (let index = 0; index < EXPECTED_SOURCE_ORDER.length; index += 1) {
    const expected = expectedImages[index];
    const result = results[index];
    if (!expected || !result) {
      continue;
    }
    const imageFailures = [];
    if (result.id !== expected.id) {
      imageFailures.push(`result id ${String(result.id)} does not match ${expected.id}`);
    }
    if (result.floatCount !== TENSOR_FLOAT_COUNT) {
      imageFailures.push(`compared ${String(result.floatCount)} floats instead of ${TENSOR_FLOAT_COUNT}`);
    }
    if (!Number.isFinite(result.meanAbsoluteError) || result.meanAbsoluteError > MEAN_ERROR_LIMIT) {
      imageFailures.push(
        `mean absolute error ${String(result.meanAbsoluteError)} exceeds ${MEAN_ERROR_LIMIT}`,
      );
    }
    if (!Number.isFinite(result.maxAbsoluteError) || result.maxAbsoluteError > MAX_ERROR_LIMIT) {
      imageFailures.push(
        `maximum absolute error ${String(result.maxAbsoluteError)} exceeds ${MAX_ERROR_LIMIT}`,
      );
    }
    if (result.dimensionsMatch !== true) {
      imageFailures.push('browser dimensions do not match the manifest');
    }
    if (expected.source === EXIF_SOURCE && result.dimensionsMatch !== true) {
      imageFailures.push('EXIF oriented dimensions do not match Python');
    }
    if (expected.source === RGBA_SOURCE && result.rgbaHiddenRgbPreserved !== true) {
      imageFailures.push('RGBA hidden RGB was composited or otherwise not preserved');
    }
    if (Array.isArray(result.failures) && result.failures.length > 0) {
      imageFailures.push(...result.failures.map((failure) => String(failure)));
    }
    if (imageFailures.length === 0) {
      passedCount += 1;
    } else {
      failures.push(`${expected.id}: ${imageFailures.join('; ')}`);
    }
  }

  if (passedCount !== EXPECTED_SOURCE_ORDER.length) {
    failures.push(`parity summary ${passedCount}/${EXPECTED_SOURCE_ORDER.length}; required 15/15`);
  }

  return {
    passed: failures.length === 0,
    passedCount,
    totalCount: EXPECTED_SOURCE_ORDER.length,
    failures,
  };
}

function requestIsLocal(requestUrl, origin) {
  const parsed = new URL(requestUrl);
  if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') {
    return true;
  }
  return parsed.protocol === 'http:' && parsed.origin === origin;
}

async function startVite(webDemoRoot) {
  const server = await createServer({
    root: webDemoRoot,
    logLevel: 'error',
    appType: 'mpa',
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: true,
      hmr: false,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  invariant(address && typeof address === 'object', 'Vite did not expose a listening address');
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

function failedBrowserResult(image, error) {
  return {
    id: image.id,
    floatCount: 0,
    meanAbsoluteError: null,
    maxAbsoluteError: null,
    originalDimensions: null,
    orientedDimensions: null,
    dimensionsMatch: false,
    rgbaHiddenRgbPreserved: image.source === RGBA_SOURCE ? false : null,
    failures: [error instanceof Error ? error.message : String(error)],
  };
}

export async function runPreprocessParity({ repositoryRoot, webDemoRoot, manifestPath }) {
  const generation = await generateParityReferences({ repositoryRoot });
  const manifest = await loadAndValidateParityManifest({ repositoryRoot, manifestPath });
  const manifestSha256 = await sha256File(manifestPath);
  const blockedRequests = [];
  const observedRequests = [];
  const browserErrors = [];
  const results = [];
  let browser;
  let vite;
  let browserVersion = 'unknown';

  try {
    const started = await startVite(webDemoRoot);
    vite = started.server;
    const { origin } = started;
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    browserVersion = browser.version();
    const context = await browser.newContext();
    await context.route('**/*', async (route) => {
      const requestUrl = route.request().url();
      if (!requestIsLocal(requestUrl, origin)) {
        blockedRequests.push(requestUrl);
        await route.abort('blockedbyclient');
        return;
      }
      if (requestUrl.startsWith('http:')) {
        observedRequests.push(requestUrl);
      }
      await route.continue();
    });

    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') {
        browserErrors.push(message.text());
      }
    });
    page.on('websocket', (socket) => {
      const socketUrl = new URL(socket.url());
      const allowedHost = new URL(origin).host;
      if (socketUrl.host !== allowedHost) {
        blockedRequests.push(socket.url());
      }
    });

    await page.goto(`${origin}/tests/browser/preprocess-harness.html`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => globalThis.__lingshuPreprocessParity?.ready === true);
    const input = page.locator('#parity-file');

    for (const image of manifest.images) {
      try {
        await page.evaluate((id) => globalThis.__lingshuPreprocessParity.prepare(id), image.id);
        await input.setInputFiles(image.sourcePath);
        const result = await page.evaluate(
          async ({ id, timeoutMilliseconds }) =>
            Promise.race([
              globalThis.__lingshuPreprocessParity.waitForResult(id),
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error(`timed out processing ${id}`)),
                  timeoutMilliseconds,
                ),
              ),
            ]),
          { id: image.id, timeoutMilliseconds: 60_000 },
        );
        results.push(result);
      } catch (error) {
        results.push(failedBrowserResult(image, error));
      }
    }

    await context.close();
    const assessment = assessParityRun({ manifest, results, blockedRequests, browserErrors });
    return {
      manifest,
      generation,
      manifestSha256,
      browserVersion,
      observedRequests: [...new Set(observedRequests)].sort(),
      blockedRequests: [...new Set(blockedRequests)].sort(),
      browserErrors,
      results,
      assessment,
    };
  } finally {
    await browser?.close();
    await vite?.close();
  }
}

async function main() {
  const webDemoRoot = fileURLToPath(new URL('../', import.meta.url));
  const repositoryRoot = path.dirname(webDemoRoot);
  const parityRoot = path.join(webDemoRoot, '.generated-tests', 'parity');
  const manifestPath = path.join(parityRoot, 'manifest.json');
  const outputPath = path.join(parityRoot, 'browser-results.json');
  const run = await runPreprocessParity({ repositoryRoot, webDemoRoot, manifestPath });
  if (run.generation.stdout.trim()) {
    process.stdout.write(run.generation.stdout);
  }
  if (run.generation.stderr.trim()) {
    process.stderr.write(run.generation.stderr);
  }
  const output = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    manifest: {
      path: 'web_demo/.generated-tests/parity/manifest.json',
      sha256: run.manifestSha256,
    },
    browser: {
      name: 'Microsoft Edge',
      version: run.browserVersion,
    },
    gates: {
      image_count: EXPECTED_SOURCE_ORDER.length,
      tensor_float_count: TENSOR_FLOAT_COUNT,
      mean_absolute_error_maximum: MEAN_ERROR_LIMIT,
      maximum_absolute_error_maximum: MAX_ERROR_LIMIT,
      exif_dimensions_match: true,
      rgba_hidden_rgb_preserved: true,
      local_requests_only: true,
    },
    summary: run.assessment,
    request_urls: run.observedRequests,
    blocked_requests: run.blockedRequests,
    browser_errors: run.browserErrors,
    images: run.results,
  };
  await mkdir(parityRoot, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  const outputSha256 = await sha256File(outputPath);

  for (const result of run.results) {
    const mean = Number.isFinite(result.meanAbsoluteError)
      ? result.meanAbsoluteError.toFixed(8)
      : 'n/a';
    const maximum = Number.isFinite(result.maxAbsoluteError)
      ? result.maxAbsoluteError.toFixed(8)
      : 'n/a';
    console.log(`${result.id}: mean=${mean} max=${maximum}`);
  }
  console.log(
    `Preprocess parity: ${run.assessment.passedCount}/${run.assessment.totalCount} passed`,
  );
  console.log(`Browser results SHA-256: ${outputSha256}`);
  console.log(`Browser results: ${outputPath}`);

  if (!run.assessment.passed) {
    for (const failure of run.assessment.failures) {
      console.error(`FAIL: ${failure}`);
    }
    return 1;
  }
  return 0;
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedUrl) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    });
}
