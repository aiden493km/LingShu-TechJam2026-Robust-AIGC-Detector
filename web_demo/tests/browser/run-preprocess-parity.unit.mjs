import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { chromium } from 'playwright-core';

import {
  EXPECTED_SOURCE_ORDER,
  MAX_ERROR_LIMIT,
  MEAN_ERROR_LIMIT,
  assessParityRun,
  closeParityResources,
  createProcessRunner,
  generateParityReferences,
  installWebSocketPolicy,
  loadAndValidateParityManifest,
  selectPythonInterpreter,
  terminateChildProcessTree,
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

function createFakeChild(pid = 1234) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  return child;
}

async function createWebSocketUpgradeServer() {
  const sockets = new Set();
  let upgradeCount = 0;
  const server = createHttpServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>WebSocket route probe</title>');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (request, socket) => {
    upgradeCount += 1;
    const key = request.headers['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.destroy();
      return;
    }
    const accept = createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    webSocketUrl: `ws://127.0.0.1:${address.port}/probe`,
    get upgradeCount() {
      return upgradeCount;
    },
    async close() {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise((resolve) => server.close(resolve));
    },
  };
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
    originalDimensions: { ...image.original_dimensions },
    orientedDimensions: { ...image.oriented_dimensions },
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
  exifMismatch[10].orientedDimensions.width += 1;
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

test('rejects negative and internally inconsistent aggregate errors', async (context) => {
  const fixture = await createManifestTree();
  context.after(() => rm(fixture.repositoryRoot, { recursive: true, force: true }));

  const negative = passingResults(fixture.manifest);
  negative[0].meanAbsoluteError = -0.001;
  assert.match(
    assessParityRun({ manifest: fixture.manifest, results: negative }).failures.join('\n'),
    /mean absolute error must be non-negative/u,
  );

  const inverted = passingResults(fixture.manifest);
  inverted[0].meanAbsoluteError = 0.02;
  inverted[0].maxAbsoluteError = 0.01;
  assert.match(
    assessParityRun({ manifest: fixture.manifest, results: inverted }).failures.join('\n'),
    /mean absolute error must not exceed maximum absolute error/u,
  );
});

test('rejects null or dishonest dimensions and non-array failure evidence', async (context) => {
  const fixture = await createManifestTree();
  context.after(() => rm(fixture.repositoryRoot, { recursive: true, force: true }));

  const nullDimensions = passingResults(fixture.manifest);
  nullDimensions[0].originalDimensions = null;
  assert.match(
    assessParityRun({ manifest: fixture.manifest, results: nullDimensions }).failures.join('\n'),
    /originalDimensions must contain exact positive integer dimensions/u,
  );

  const dishonestDimensions = passingResults(fixture.manifest);
  dishonestDimensions[0].originalDimensions.width += 1;
  assert.match(
    assessParityRun({ manifest: fixture.manifest, results: dishonestDimensions }).failures.join('\n'),
    /dimensionsMatch is inconsistent/u,
  );

  const stringFailures = passingResults(fixture.manifest);
  stringFailures[0].failures = 'not-an-array';
  assert.match(
    assessParityRun({ manifest: fixture.manifest, results: stringFailures }).failures.join('\n'),
    /failures must be an array/u,
  );
});

test('requires exact result keys, unique frozen order, and an exact RGBA flag', async (context) => {
  const fixture = await createManifestTree();
  context.after(() => rm(fixture.repositoryRoot, { recursive: true, force: true }));

  const extraKey = passingResults(fixture.manifest);
  extraKey[0].untrusted = 'extra';
  assert.match(
    assessParityRun({ manifest: fixture.manifest, results: extraKey }).failures.join('\n'),
    /result keys must be exactly/u,
  );

  const duplicate = passingResults(fixture.manifest);
  duplicate[1].id = duplicate[0].id;
  assert.match(
    assessParityRun({ manifest: fixture.manifest, results: duplicate }).failures.join('\n'),
    /unique ids in frozen order/u,
  );

  const wrongRgbaFlag = passingResults(fixture.manifest);
  wrongRgbaFlag[0].rgbaHiddenRgbPreserved = true;
  assert.match(
    assessParityRun({ manifest: fixture.manifest, results: wrongRgbaFlag }).failures.join('\n'),
    /rgbaHiddenRgbPreserved must be null/u,
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
  assert.equal(calls[0].options.timeoutMilliseconds, 10_000);
  assert.equal(calls[0].options.maxOutputBytes, 64 * 1024);
  assert.equal(calls[1].command, 'py');
  assert.deepEqual(calls[1].args.slice(0, 2), ['-3', '-c']);
  assert.equal(calls[1].options.windowsHide, true);
  assert.equal(calls[1].options.timeoutMilliseconds, 10_000);
  assert.equal(calls[1].options.maxOutputBytes, 64 * 1024);
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
  assert.equal(calls[1].options.timeoutMilliseconds, 120_000);
  assert.equal(calls[1].options.maxOutputBytes, 1024 * 1024);
  assert.match(calls[1].args.join(' '), /generate_parity_references\.py/u);
});

test('injectable process runner bounds output and terminates the tree on deadline', async () => {
  const child = createFakeChild(2468);
  let timeoutCallback;
  let clearedTimer = false;
  const terminated = [];
  const runner = createProcessRunner({
    spawnImpl: () => child,
    setTimeoutImpl(callback) {
      timeoutCallback = callback;
      return 99;
    },
    clearTimeoutImpl(timer) {
      assert.equal(timer, 99);
      clearedTimer = true;
    },
    async terminateTree(target) {
      terminated.push(target.pid);
    },
  });

  const completion = runner('python', ['generator.py'], {
    cwd: path.resolve('C:/workspace/repository'),
    windowsHide: true,
    timeoutMilliseconds: 25,
    maxOutputBytes: 4,
  });
  child.stdout.write('abcdef');
  child.stderr.write('uvwxyz');
  await timeoutCallback();
  const result = await completion;

  assert.equal(result.timedOut, true);
  assert.equal(result.stdout, 'abcd');
  assert.equal(result.stderr, 'uvwx');
  assert.equal(result.outputTruncated, true);
  assert.deepEqual(terminated, [2468]);
  assert.equal(clearedTimer, true);
});

test('Windows timeout termination uses taskkill for the exact child process tree', async () => {
  const child = createFakeChild(4321);
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const taskkill = createFakeChild(9876);
    queueMicrotask(() => taskkill.emit('close', 0, null));
    return taskkill;
  };

  await terminateChildProcessTree(child, { platform: 'win32', spawnImpl });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'taskkill.exe');
  assert.deepEqual(calls[0].args, ['/pid', '4321', '/t', '/f']);
  assert.deepEqual(calls[0].options, { windowsHide: true, stdio: 'ignore' });
});

test('WebSocket policy connects only the exact selected origin before upgrade', async () => {
  const allowedServer = await createWebSocketUpgradeServer();
  const blockedServer = await createWebSocketUpgradeServer();
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext();
    const blockedRequests = [];
    const observedWebSockets = [];
    await installWebSocketPolicy(context, {
      origin: allowedServer.origin,
      blockedRequests,
      observedWebSockets,
    });
    const page = await context.newPage();
    await page.goto(allowedServer.origin);

    const allowedOutcome = await page.evaluate(
      (url) =>
        new Promise((resolve) => {
          const socket = new WebSocket(url);
          const timer = setTimeout(() => resolve('timeout'), 5_000);
          socket.addEventListener(
            'open',
            () => {
              clearTimeout(timer);
              socket.close();
              resolve('open');
            },
            { once: true },
          );
          socket.addEventListener('error', () => resolve('error'), { once: true });
        }),
      allowedServer.webSocketUrl,
    );
    const blockedOutcome = await page.evaluate(
      (url) =>
        new Promise((resolve) => {
          const socket = new WebSocket(url);
          const timer = setTimeout(() => resolve('timeout'), 5_000);
          socket.addEventListener('open', () => resolve('open'), { once: true });
          socket.addEventListener(
            'error',
            () => {
              clearTimeout(timer);
              resolve('blocked');
            },
            { once: true },
          );
          socket.addEventListener(
            'close',
            () => {
              clearTimeout(timer);
              resolve('blocked');
            },
            { once: true },
          );
        }),
      blockedServer.webSocketUrl,
    );

    assert.equal(allowedOutcome, 'open');
    assert.equal(blockedOutcome, 'blocked');
    assert.equal(allowedServer.upgradeCount, 1);
    assert.equal(blockedServer.upgradeCount, 0);
    assert.deepEqual(observedWebSockets, [allowedServer.webSocketUrl]);
    assert.deepEqual(blockedRequests, [blockedServer.webSocketUrl]);
    await context.close();
  } finally {
    await Promise.allSettled([
      browser?.close(),
      allowedServer.close(),
      blockedServer.close(),
    ]);
  }
});

test('resource cleanup still closes Vite when browser close rejects', async () => {
  const closed = [];
  const context = { close: async () => closed.push('context') };
  const browser = {
    close: async () => {
      closed.push('browser');
      throw new Error('browser close failed');
    },
  };
  const vite = { close: async () => closed.push('vite') };

  await assert.rejects(
    closeParityResources({ context, browser, vite }),
    /failed to close parity resources.*browser close failed/u,
  );
  assert.deepEqual(closed.sort(), ['browser', 'context', 'vite']);
});
