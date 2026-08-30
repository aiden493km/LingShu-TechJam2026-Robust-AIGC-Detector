#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  EXPECTED_PARITY_SOURCES,
  validateAcceptanceReport,
  validateParityManifest,
} from './run_browser_acceptance.mjs';
import {
  MAX_ERROR_LIMIT,
  MEAN_ERROR_LIMIT,
  assessParityRun,
} from './run_preprocess_parity.mjs';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const MODEL_PATH = 'web_demo/models/baseline2_njr_fp32.onnx';
const ORT_WORKER = Object.freeze({
  path: 'assets/ort-wasm-simd-threaded.asyncify.mjs',
  bytes: 51_407,
  sha256: '5d25483158d53d8f34d0e9c06a654d56c8dca4ebdf370ea0982ef11315a00e0e',
});
const ORT_WASM = Object.freeze({
  path: 'assets/ort-wasm-simd-threaded.asyncify.wasm',
  bytes: 25_749_873,
  sha256: '503d17cb7411b79781b9fad1cf0978f03cf06b050c7d399c730e914f473bf549',
});
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..', '..');
const PROCESS_OUTPUT_LIMIT = 1024 * 1024;
const INPUT_PATHS = Object.freeze({
  browserAcceptance: path.join(
    'web_demo',
    '.generated-tests',
    'browser-acceptance',
    'latest.json',
  ),
  preprocessParity: path.join(
    'web_demo',
    '.generated-tests',
    'parity',
    'browser-results.json',
  ),
  parityManifest: path.join('web_demo', '.generated-tests', 'parity', 'manifest.json'),
  packageLock: path.join('web_demo', 'package-lock.json'),
  integrityManifest: path.join('web_demo', 'dist', 'integrity.json'),
});
const FORMAL_OUTPUT_PATH = path.join('results', 'web_demo_acceptance', 'latest.json');
const PREPROCESS_REPORT_KEYS = Object.freeze([
  'blocked_requests',
  'browser',
  'browser_errors',
  'gates',
  'generated_at',
  'images',
  'manifest',
  'request_urls',
  'schema_version',
  'summary',
  'websocket_urls',
]);
const MANIFEST_KEYS = Object.freeze([
  'images',
  'model',
  'preprocessing',
  'schema_version',
  'tensor',
  'threshold',
]);
const MANIFEST_IMAGE_KEYS = Object.freeze([
  'id',
  'label',
  'logit',
  'oriented_dimensions',
  'original_dimensions',
  'probability',
  'reference',
  'source',
  'tensor',
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
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

function expectCanonicalIso(value, label) {
  invariant(typeof value === 'string' && value.length > 0, `${label} must be a non-empty string`);
  const parsed = new Date(value);
  invariant(
    !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value,
    `${label} must be canonical ISO-8601`,
  );
  return parsed;
}

function expectStringArray(value, label) {
  invariant(Array.isArray(value), `${label} must be an array`);
  invariant(value.every((item) => typeof item === 'string'), `${label} must contain strings`);
  return value;
}

function expectedImageId(source) {
  return source.replace(/\.[^.]+$/u, '').replaceAll('/', '__');
}

function validateManifestSchema(manifest) {
  expectExactKeys(manifest, MANIFEST_KEYS, 'parity manifest');
  expectExactKeys(
    manifest.tensor,
    ['byte_order', 'bytes', 'dtype', 'float_count', 'layout', 'shape'],
    'parity manifest tensor',
  );
  expectExactKeys(
    manifest.model,
    ['bytes', 'file', 'input_name', 'output_name', 'sha256', 'source'],
    'parity manifest model',
  );
  invariant(
    manifest.preprocessing === 'inference.preprocess_image',
    'parity manifest preprocessing must identify inference.preprocess_image',
  );
  validateParityManifest(manifest);
  for (const [index, row] of manifest.images.entries()) {
    const label = `parity manifest images[${index}]`;
    expectExactKeys(row, MANIFEST_IMAGE_KEYS, label);
    expectExactKeys(row.original_dimensions, ['height', 'width'], `${label}.original_dimensions`);
    expectExactKeys(row.oriented_dimensions, ['height', 'width'], `${label}.oriented_dimensions`);
    expectExactKeys(
      row.tensor,
      ['bytes', 'float_count', 'sha256', 'shape'],
      `${label}.tensor`,
    );
    const expectedSource = EXPECTED_PARITY_SOURCES[index];
    const expectedId = expectedImageId(expectedSource);
    invariant(row.id === expectedId, `${label}.id must match its frozen source`);
    invariant(row.reference === `tensors/${expectedId}.f32`, `${label}.reference is invalid`);
    const expectedProbability = row.logit >= 0
      ? 1 / (1 + Math.exp(-row.logit))
      : Math.exp(row.logit) / (1 + Math.exp(row.logit));
    invariant(
      Math.abs(row.probability - expectedProbability) <= 1e-12,
      `${label}.probability must match its logit`,
    );
  }
  return manifest;
}

function validateLocalRequestEvidence(report) {
  const requestUrls = expectStringArray(report.request_urls, 'preprocess report request_urls');
  invariant(requestUrls.length > 0, 'preprocess report must record at least one local request');
  let httpOrigin;
  for (const requestUrl of requestUrls) {
    const parsed = new URL(requestUrl);
    invariant(
      parsed.protocol === 'http:' &&
        parsed.hostname === '127.0.0.1' &&
        parsed.port !== '' &&
        parsed.username === '' &&
        parsed.password === '',
      `preprocess report contains a non-loopback request: ${requestUrl}`,
    );
    httpOrigin ??= parsed.origin;
    invariant(parsed.origin === httpOrigin, 'preprocess report request origins must be identical');
  }

  const websocketUrls = expectStringArray(
    report.websocket_urls,
    'preprocess report websocket_urls',
  );
  const expectedWebSocketOrigin = httpOrigin.replace(/^http:/u, 'ws:');
  for (const websocketUrl of websocketUrls) {
    const parsed = new URL(websocketUrl);
    invariant(
      parsed.protocol === 'ws:' &&
        parsed.origin === expectedWebSocketOrigin &&
        parsed.username === '' &&
        parsed.password === '',
      `preprocess report contains a non-loopback WebSocket: ${websocketUrl}`,
    );
  }
}

export function validatePreprocessEvidence({
  report,
  manifest,
  manifestSha256,
  acceptanceReport,
}) {
  validateAcceptanceReport(acceptanceReport);
  validateManifestSchema(manifest);
  invariant(
    typeof manifestSha256 === 'string' && SHA256_PATTERN.test(manifestSha256),
    'parity manifest SHA-256 must be lowercase hexadecimal',
  );
  expectExactKeys(report, PREPROCESS_REPORT_KEYS, 'preprocess report');
  invariant(report.schema_version === 1, 'preprocess report schema_version must equal 1');
  const generatedAt = expectCanonicalIso(report.generated_at, 'preprocess report generated_at');
  const acceptanceGeneratedAt = expectCanonicalIso(
    acceptanceReport.generatedAt,
    'acceptance report generatedAt',
  );
  invariant(
    generatedAt >= acceptanceGeneratedAt,
    'preprocess report must be generated after browser acceptance',
  );

  const reportManifest = expectExactKeys(
    report.manifest,
    ['path', 'sha256'],
    'preprocess report manifest',
  );
  invariant(
    reportManifest.path === 'web_demo/.generated-tests/parity/manifest.json',
    'preprocess report manifest path is invalid',
  );
  invariant(
    reportManifest.sha256 === manifestSha256,
    'preprocess report manifest SHA-256 does not match the manifest bytes',
  );

  const browser = expectExactKeys(report.browser, ['name', 'version'], 'preprocess report browser');
  invariant(browser.name === 'Microsoft Edge', 'preprocess report browser must be Microsoft Edge');
  invariant(
    browser.version === acceptanceReport.runtime.edge,
    'preprocess and browser acceptance Edge versions must match',
  );

  const gates = expectExactKeys(
    report.gates,
    [
      'exif_dimensions_match',
      'image_count',
      'local_requests_only',
      'maximum_absolute_error_maximum',
      'mean_absolute_error_maximum',
      'rgba_hidden_rgb_preserved',
      'tensor_float_count',
    ],
    'preprocess report gates',
  );
  invariant(gates.image_count === 15, 'preprocess image gate must equal 15');
  invariant(gates.tensor_float_count === 442_368, 'preprocess tensor float gate is invalid');
  invariant(
    gates.mean_absolute_error_maximum === MEAN_ERROR_LIMIT,
    `preprocess mean absolute error gate must equal ${MEAN_ERROR_LIMIT}`,
  );
  invariant(
    gates.maximum_absolute_error_maximum === MAX_ERROR_LIMIT,
    `preprocess maximum absolute error gate must equal ${MAX_ERROR_LIMIT}`,
  );
  for (const key of [
    'exif_dimensions_match',
    'rgba_hidden_rgb_preserved',
    'local_requests_only',
  ]) {
    invariant(gates[key] === true, `preprocess gate ${key} must pass`);
  }

  const blockedRequests = expectStringArray(
    report.blocked_requests,
    'preprocess report blocked_requests',
  );
  const browserErrors = expectStringArray(report.browser_errors, 'preprocess report browser_errors');
  invariant(blockedRequests.length === 0, 'preprocess report contains blocked requests');
  invariant(browserErrors.length === 0, 'preprocess report contains browser errors');
  validateLocalRequestEvidence(report);

  const assessment = assessParityRun({
    manifest,
    results: report.images,
    blockedRequests,
    browserErrors,
  });
  expectExactKeys(
    report.summary,
    ['failures', 'passed', 'passedCount', 'totalCount'],
    'preprocess report summary',
  );
  invariant(
    JSON.stringify(report.summary) === JSON.stringify(assessment),
    'preprocess report summary is inconsistent with its image evidence',
  );
  invariant(
    assessment.passed && assessment.passedCount === 15 && assessment.totalCount === 15,
    'preprocess report must pass all 15 images',
  );
  invariant(
    manifest.model.bytes === acceptanceReport.model.bytes &&
      manifest.model.sha256 === acceptanceReport.model.sha256,
    'preprocess manifest model identity must match browser acceptance',
  );
  invariant(
    manifest.threshold === acceptanceReport.threshold,
    'preprocess manifest threshold must match browser acceptance',
  );
  return report;
}

function lockedPackageVersion(packageLock, packageName, dependencyGroup) {
  const packages = expectRecord(packageLock?.packages, 'package-lock packages');
  const root = expectRecord(packages[''], 'package-lock root package');
  const declarations = expectRecord(
    root[dependencyGroup],
    `package-lock root ${dependencyGroup}`,
  );
  const locked = expectRecord(
    packages[`node_modules/${packageName}`],
    `package-lock ${packageName}`,
  );
  invariant(
    typeof locked.version === 'string' && locked.version.length > 0,
    `package-lock ${packageName} version must be non-empty`,
  );
  invariant(
    declarations[packageName] === locked.version,
    `package-lock ${packageName} declaration must exactly match the locked version`,
  );
  return locked.version;
}

function exactIntegrityArtifact(integrityManifest, expected) {
  invariant(integrityManifest?.schema_version === 1, 'dist integrity schema_version must equal 1');
  invariant(Array.isArray(integrityManifest.files), 'dist integrity files must be an array');
  const matching = integrityManifest.files.filter((row) => row?.path === expected.path);
  invariant(matching.length === 1, `dist integrity must contain exactly one ${expected.path}`);
  const [actual] = matching;
  invariant(
    actual.bytes === expected.bytes && actual.sha256 === expected.sha256,
    `dist integrity identity mismatch for ${expected.path}`,
  );
  return { ...expected };
}

function validateRawHashes(rawHashes) {
  const hashes = expectExactKeys(
    rawHashes,
    ['browserAcceptance', 'parityManifest', 'preprocessParity'],
    'raw report hashes',
  );
  for (const [label, hash] of Object.entries(hashes)) {
    invariant(
      typeof hash === 'string' && SHA256_PATTERN.test(hash),
      `raw report hash ${label} must be lowercase SHA-256`,
    );
  }
  return hashes;
}

export function buildFormalEvidence({
  acceptanceReport,
  preprocessReport,
  parityManifest,
  rawHashes,
  packageLock,
  integrityManifest,
  generatedAt,
  testedCommit,
}) {
  invariant(
    typeof testedCommit === 'string' && GIT_COMMIT_PATTERN.test(testedCommit),
    'testedCommit must be a full lowercase Git SHA-1',
  );
  invariant(
    acceptanceReport?.commit === testedCommit,
    'testedCommit must equal the browser acceptance commit',
  );
  const hashes = validateRawHashes(rawHashes);
  validatePreprocessEvidence({
    report: preprocessReport,
    manifest: parityManifest,
    manifestSha256: hashes.parityManifest,
    acceptanceReport,
  });
  const formalGeneratedAt = expectCanonicalIso(generatedAt, 'formal evidence generatedAt');
  invariant(
    formalGeneratedAt >= expectCanonicalIso(preprocessReport.generated_at, 'preprocess generated_at'),
    'formal evidence must be generated after preprocess parity',
  );

  const onnxruntimeWeb = lockedPackageVersion(
    packageLock,
    'onnxruntime-web',
    'dependencies',
  );
  const playwrightCore = lockedPackageVersion(
    packageLock,
    'playwright-core',
    'devDependencies',
  );
  const vite = lockedPackageVersion(packageLock, 'vite', 'devDependencies');
  const ortWorker = exactIntegrityArtifact(integrityManifest, ORT_WORKER);
  const ortWasm = exactIntegrityArtifact(integrityManifest, ORT_WASM);

  return {
    schemaVersion: 1,
    passed: true,
    generatedAt,
    testedCommit,
    evidencePolicy: {
      testedCommitMeaning:
        'Exact committed code and artifacts executed by browser acceptance and tensor parity.',
      evidenceCommitRelationship:
        'The evidence-only commit is expected to have testedCommit as its direct parent.',
    },
    commands: [
      'npm.cmd run test:browser-acceptance',
      'npm.cmd run test:preprocess-parity',
      'npm.cmd run record:acceptance-evidence',
    ],
    environment: {
      platform: acceptanceReport.platform,
      browser: {
        name: preprocessReport.browser.name,
        version: preprocessReport.browser.version,
      },
      runtime: {
        node: acceptanceReport.runtime.node,
        python: acceptanceReport.runtime.python,
        onnxruntimeWeb,
        playwrightCore,
        vite,
      },
    },
    artifacts: {
      model: {
        path: MODEL_PATH,
        bytes: acceptanceReport.model.bytes,
        sha256: acceptanceReport.model.sha256,
      },
      ortWorker,
      ortWasm,
      threshold: acceptanceReport.threshold,
    },
    sourceReports: {
      browserAcceptance: {
        path: 'web_demo/.generated-tests/browser-acceptance/latest.json',
        sha256: hashes.browserAcceptance,
      },
      preprocessParity: {
        path: 'web_demo/.generated-tests/parity/browser-results.json',
        sha256: hashes.preprocessParity,
      },
      parityManifest: {
        path: 'web_demo/.generated-tests/parity/manifest.json',
        sha256: hashes.parityManifest,
      },
    },
    tensorParity: {
      report: preprocessReport,
      referenceManifest: parityManifest,
    },
    browserAcceptance: acceptanceReport,
  };
}

function captureTrackedGitState(repositoryRoot) {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: PROCESS_OUTPUT_LIMIT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  invariant(head.status === 0, `git rev-parse HEAD failed: ${head.stderr ?? ''}`);
  const status = spawnSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=no'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: PROCESS_OUTPUT_LIMIT,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  invariant(status.status === 0, `git tracked-state inspection failed: ${status.stderr ?? ''}`);
  return { head: head.stdout.trim(), porcelain: status.stdout };
}

export function assertSameCleanGitState(initial, current) {
  expectExactKeys(initial, ['head', 'porcelain'], 'initial Git state');
  expectExactKeys(current, ['head', 'porcelain'], 'current Git state');
  invariant(GIT_COMMIT_PATTERN.test(initial.head), 'initial Git HEAD must be a full SHA-1');
  invariant(GIT_COMMIT_PATTERN.test(current.head), 'current Git HEAD must be a full SHA-1');
  invariant(initial.porcelain === '', 'Tracked index/worktree must be clean before evidence recording');
  invariant(current.porcelain === '', 'Tracked index/worktree must remain clean before formal write');
  invariant(current.head === initial.head, 'Git HEAD changed during evidence recording');
  return initial.head;
}

async function readRegularJson(filePath, label) {
  const information = await lstat(filePath).catch(() => null);
  invariant(
    information?.isFile() === true && !information.isSymbolicLink(),
    `${label} must be a regular file: ${filePath}`,
  );
  const bytes = await readFile(filePath);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    value,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function writeAtomicJson(destination, value) {
  const directory = path.dirname(destination);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.latest.json.tmp-${process.pid}-${randomUUID()}`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export async function recordAcceptanceEvidence({
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  now = () => new Date(),
  gitStateReader = captureTrackedGitState,
} = {}) {
  const root = path.resolve(repositoryRoot);
  const initialGitState = gitStateReader(root);
  const testedCommit = assertSameCleanGitState(initialGitState, initialGitState);
  const inputEntries = await Promise.all(
    Object.entries(INPUT_PATHS).map(async ([label, relativePath]) => [
      label,
      await readRegularJson(path.join(root, relativePath), label),
    ]),
  );
  const inputs = Object.fromEntries(inputEntries);
  const acceptance = inputs.browserAcceptance;
  const preprocess = inputs.preprocessParity;
  const manifest = inputs.parityManifest;
  const packageLockFile = inputs.packageLock;
  const integrity = inputs.integrityManifest;
  const generatedDate = now();
  invariant(
    generatedDate instanceof Date && !Number.isNaN(generatedDate.valueOf()),
    'evidence clock must return a valid Date',
  );
  const formalEvidence = buildFormalEvidence({
    acceptanceReport: acceptance.value,
    preprocessReport: preprocess.value,
    parityManifest: manifest.value,
    rawHashes: {
      browserAcceptance: acceptance.sha256,
      preprocessParity: preprocess.sha256,
      parityManifest: manifest.sha256,
    },
    packageLock: packageLockFile.value,
    integrityManifest: integrity.value,
    generatedAt: generatedDate.toISOString(),
    testedCommit,
  });
  assertSameCleanGitState(initialGitState, gitStateReader(root));
  await writeAtomicJson(path.join(root, FORMAL_OUTPUT_PATH), formalEvidence);
  return formalEvidence;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  if (process.argv.length !== 2) {
    process.stderr.write('record_acceptance_evidence.mjs accepts no arguments; output is fixed.\n');
    process.exitCode = 1;
  } else {
    recordAcceptanceEvidence()
      .then((evidence) => {
        process.stdout.write(
          `Recorded formal WebDemo acceptance for ${evidence.testedCommit} at ${FORMAL_OUTPUT_PATH}\n`,
        );
      })
      .catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
        process.exitCode = 1;
      });
  }
}
