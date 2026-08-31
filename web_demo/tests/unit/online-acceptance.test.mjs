import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EXPECTED_MODEL_BYTES,
  EXPECTED_MODEL_PATH,
  EXPECTED_MODEL_SHA256,
  classifyRequest,
  compactProgressSamples,
  compareOnlinePrediction,
  parseCliArguments,
  parseOnlineUrl,
  runOnlineAcceptance,
  validateOnlineEvidence,
  validateProgressSamples,
  validateResponseHeaders,
} from '../../tools/run_online_acceptance.mjs';

const DEPLOYMENT_URL = 'https://lingshu-preview.vercel.app/';
const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

function responseHeaders(kind) {
  const mutable = kind === 'root' || kind === 'manifest';
  return {
    ...SECURITY_HEADERS,
    'cache-control': mutable
      ? 'public, max-age=0, must-revalidate'
      : 'public, max-age=31536000, immutable',
    'content-type': kind === 'root'
      ? 'text/html; charset=utf-8'
      : kind === 'manifest'
        ? 'application/json; charset=utf-8'
        : kind === 'model'
          ? 'application/octet-stream'
          : kind === 'ort-wasm'
            ? 'application/wasm'
          : 'application/javascript; charset=utf-8',
    etag: '"bounded-etag"',
    ...(kind === 'model' ? { 'content-length': String(EXPECTED_MODEL_BYTES) } : {}),
  };
}

function headerCheck(kind, path) {
  return {
    kind,
    path,
    status: 200,
    headers: responseHeaders(kind),
  };
}

function prediction(source, index, provider) {
  const referenceProbability = index < 6 ? 0.99 : 0.000001;
  return {
    source,
    referenceProbability,
    probability: referenceProbability,
    absoluteError: 0,
    label: referenceProbability >= 0.55657113 ? 'AIGC' : 'Real',
    provider,
    thresholdFlip: false,
  };
}

function validEvidence() {
  const sources = [
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
  ];
  return {
    schema_version: 1,
    passed: true,
    generatedAt: '2026-08-31T00:00:00.000Z',
    testedCommit: 'a'.repeat(40),
    deploymentUrl: DEPLOYMENT_URL,
    browser: { name: 'Microsoft Edge', version: '140.0.0.0' },
    headers: {
      resources: [
        headerCheck('root', '/'),
        headerCheck('manifest', '/models/manifest.json'),
        headerCheck('model', EXPECTED_MODEL_PATH),
        headerCheck('ort-mjs', '/assets/ort.webgpu.min.mjs'),
        headerCheck('ort-wasm', '/assets/ort-wasm-simd-threaded.asyncify.wasm'),
      ],
    },
    model: {
      path: EXPECTED_MODEL_PATH,
      bytes: EXPECTED_MODEL_BYTES,
      sha256: EXPECTED_MODEL_SHA256,
      progress: [
        { loaded: 0, total: EXPECTED_MODEL_BYTES },
        { loaded: 65536, total: EXPECTED_MODEL_BYTES },
        { loaded: EXPECTED_MODEL_BYTES, total: EXPECTED_MODEL_BYTES },
      ],
    },
    providers: ['webgpu', 'wasm'],
    providerRuns: [
      {
        mode: 'webgpu',
        provider: 'webgpu',
        crossOriginIsolated: true,
        predictions: sources.map((source, index) => prediction(source, index, 'webgpu')),
      },
      {
        mode: 'wasm',
        provider: 'wasm',
        crossOriginIsolated: true,
        predictions: sources.map((source, index) => prediction(source, index, 'wasm')),
      },
    ],
    crossOriginIsolated: true,
    thresholdFlips: 0,
    privacy: {
      requestCount: 8,
      externalOrigins: [],
      disallowedMethods: [],
      imageRequests: 0,
      requests: [
        { method: 'GET', kind: 'same-origin', path: '/', count: 4 },
        { method: 'GET', kind: 'model', path: EXPECTED_MODEL_PATH, count: 4 },
      ],
    },
    cache: {
      reloadModelRequests: 1,
      observations: [{ path: EXPECTED_MODEL_PATH, transferSize: 0, encodedBodySize: EXPECTED_MODEL_BYTES }],
      interpretation: 'A reload observation only; no permanent-cache claim.',
    },
    offline: {
      completed: true,
      source: 'demo_images/r5.png',
      provider: 'webgpu',
      probability: 0.000001,
      label: 'Real',
    },
    console: { warnings: [], errors: [], pageErrors: [] },
  };
}

describe('online deployment URL', () => {
  it('accepts and normalizes exactly one HTTPS origin URL', () => {
    assert.equal(parseOnlineUrl('https://Example.Vercel.app'), 'https://example.vercel.app/');
  });

  for (const value of [
    'http://example.vercel.app/',
    'https://user:pass@example.vercel.app/',
    'https://example.vercel.app/path',
    'https://example.vercel.app/?token=secret',
    'https://example.vercel.app/#fragment',
    ' https://example.vercel.app/',
    '',
  ]) {
    it(`rejects unsafe or non-root URL ${JSON.stringify(value)}`, () => {
      assert.throws(() => parseOnlineUrl(value), /HTTPS|credentials|root|query|fragment|whitespace|URL/i);
    });
  }

  it('requires exactly one positional deployment URL', () => {
    assert.equal(parseCliArguments([DEPLOYMENT_URL]), DEPLOYMENT_URL);
    assert.throws(() => parseCliArguments([]), /exactly one/i);
    assert.throws(() => parseCliArguments([DEPLOYMENT_URL, DEPLOYMENT_URL]), /exactly one/i);
  });
});

describe('request classification', () => {
  it('distinguishes the exact model route, other same-origin requests, and external origins', () => {
    assert.equal(classifyRequest(`${DEPLOYMENT_URL.slice(0, -1)}${EXPECTED_MODEL_PATH}`, DEPLOYMENT_URL), 'model');
    assert.equal(classifyRequest(`${DEPLOYMENT_URL}assets/app.js`, DEPLOYMENT_URL), 'same-origin');
    assert.equal(classifyRequest('https://telemetry.example/collect', DEPLOYMENT_URL), 'external');
  });

  it('does not treat a lookalike model path or subdomain as the model request', () => {
    assert.equal(classifyRequest(`${DEPLOYMENT_URL}models/other.onnx`, DEPLOYMENT_URL), 'same-origin');
    assert.equal(classifyRequest('https://evil.lingshu-preview.vercel.app/models/baseline2_njr_fp32.onnx', DEPLOYMENT_URL), 'external');
  });
});

describe('model progress evidence', () => {
  const samples = [
    { loaded: 0, total: EXPECTED_MODEL_BYTES },
    { loaded: 1024, total: EXPECTED_MODEL_BYTES },
    { loaded: 1024, total: EXPECTED_MODEL_BYTES },
    { loaded: 4096, total: EXPECTED_MODEL_BYTES },
    { loaded: EXPECTED_MODEL_BYTES, total: EXPECTED_MODEL_BYTES },
  ];

  it('accepts monotonic real progress ending at the exact model byte count', () => {
    assert.deepEqual(validateProgressSamples(samples), samples);
  });

  it('compacts large progress logs while preserving endpoints and monotonicity', () => {
    const long = Array.from({ length: 300 }, (_, index) => ({
      loaded: Math.round((EXPECTED_MODEL_BYTES * index) / 299),
      total: EXPECTED_MODEL_BYTES,
    }));
    const compacted = compactProgressSamples(long, 32);
    assert.ok(compacted.length <= 32);
    assert.deepEqual(compacted[0], long[0]);
    assert.deepEqual(compacted.at(-1), long.at(-1));
    validateProgressSamples(compacted);
  });

  for (const samples of [
    [{ loaded: 1, total: EXPECTED_MODEL_BYTES }, { loaded: EXPECTED_MODEL_BYTES, total: EXPECTED_MODEL_BYTES }],
    [{ loaded: 0, total: EXPECTED_MODEL_BYTES }, { loaded: EXPECTED_MODEL_BYTES - 1, total: EXPECTED_MODEL_BYTES }],
    [{ loaded: 0, total: EXPECTED_MODEL_BYTES }, { loaded: 10, total: EXPECTED_MODEL_BYTES }, { loaded: 9, total: EXPECTED_MODEL_BYTES }, { loaded: EXPECTED_MODEL_BYTES, total: EXPECTED_MODEL_BYTES }],
    [{ loaded: 0, total: 10 }, { loaded: 5, total: 10 }, { loaded: 10, total: 10 }],
  ]) {
    it('rejects incomplete, non-monotonic, or wrong-total samples', () => {
      assert.throws(() => validateProgressSamples(samples), /progress|loaded|total|88123029|monotonic|terminal/i);
    });
  }
});

describe('response header gates', () => {
  it('accepts the exact isolation/security policy and resource cache policy', () => {
    assert.equal(validateResponseHeaders(responseHeaders('root'), 'root')['cross-origin-opener-policy'], 'same-origin');
    assert.equal(validateResponseHeaders(responseHeaders('model'), 'model')['content-length'], String(EXPECTED_MODEL_BYTES));
  });

  it('rejects a weakened isolation header or mutable model cache', () => {
    assert.throws(
      () => validateResponseHeaders({ ...responseHeaders('root'), 'cross-origin-embedder-policy': 'unsafe-none' }, 'root'),
      /embedder|require-corp/i,
    );
    assert.throws(
      () => validateResponseHeaders({ ...responseHeaders('model'), 'cache-control': 'no-store' }, 'model'),
      /cache-control|immutable/i,
    );
  });
});

describe('prediction parity', () => {
  it('records error and detects threshold flips independently of tolerance', () => {
    assert.deepEqual(compareOnlinePrediction(0.558, 0.55), {
      absoluteError: 0.008000000000000007,
      expectedLabel: 'AIGC',
      actualLabel: 'Real',
      thresholdFlip: true,
      withinTolerance: true,
    });
    assert.equal(compareOnlinePrediction(0.9, 0.88).withinTolerance, false);
  });
});

describe('bounded online evidence schema', () => {
  it('accepts the complete WebGPU plus WASM delivery evidence', () => {
    assert.equal(validateOnlineEvidence(validEvidence()).passed, true);
  });

  it('requires the exact model identity, provider set, privacy boundary, and zero flips', () => {
    const cases = [
      (value) => { value.model.bytes -= 1; },
      (value) => { value.model.sha256 = '0'.repeat(64); },
      (value) => { value.providers = ['wasm']; },
      (value) => { value.thresholdFlips = 1; },
      (value) => { value.privacy.imageRequests = 1; },
      (value) => { value.crossOriginIsolated = false; },
    ];
    for (const mutate of cases) {
      const value = validEvidence();
      mutate(value);
      assert.throws(() => validateOnlineEvidence(value), /model|provider|flip|image|isolated|88123029|sha/i);
    }
  });

  it('rejects sensitive fields, query-bearing URLs, and unbounded logs', () => {
    const secret = validEvidence();
    secret.privacy.authorization = 'Bearer should-never-be-recorded';
    assert.throws(() => validateOnlineEvidence(secret), /sensitive|authorization/i);

    const query = validEvidence();
    query.cache.observations[0].path = '/model?token=secret';
    assert.throws(() => validateOnlineEvidence(query), /query|fragment|sensitive|path/i);

    const unbounded = validEvidence();
    unbounded.privacy.requests = Array.from({ length: 101 }, () => ({
      method: 'GET',
      kind: 'same-origin',
      path: '/',
    }));
    unbounded.privacy.requestCount = 101;
    assert.throws(() => validateOnlineEvidence(unbounded), /bounded|100|request/i);
  });

  it('requires exactly ten bounded parity rows per provider and valid header evidence', () => {
    const missingPrediction = validEvidence();
    missingPrediction.providerRuns[0].predictions.pop();
    assert.throws(() => validateOnlineEvidence(missingPrediction), /10|prediction/i);

    const weakHeader = validEvidence();
    weakHeader.headers.resources[0].headers['content-security-policy'] = "default-src *";
    assert.throws(() => validateOnlineEvidence(weakHeader), /content-security-policy|CSP/i);
  });
});

describe('dependency-injected acceptance orchestration', () => {
  it('validates one stable clean commit and writes only the validated candidate', async () => {
    const full = validEvidence();
    const {
      schema_version: _schemaVersion,
      passed: _passed,
      generatedAt: _generatedAt,
      testedCommit: _testedCommit,
      deploymentUrl: _deploymentUrl,
      ...checks
    } = full;
    const states = [
      { head: 'a'.repeat(40), porcelain: '' },
      { head: 'a'.repeat(40), porcelain: '' },
      { head: 'a'.repeat(40), porcelain: '' },
    ];
    let checksRun = 0;
    let written;

    const result = await runOnlineAcceptance(DEPLOYMENT_URL, {
      repositoryRoot: 'C:\\isolated-repository',
      inspectGit: async () => states.shift(),
      runChecks: async ({ deploymentUrl, repositoryRoot }) => {
        checksRun += 1;
        assert.equal(deploymentUrl, DEPLOYMENT_URL);
        assert.equal(repositoryRoot, 'C:\\isolated-repository');
        return checks;
      },
      writeCandidate: async (repositoryRoot, evidence) => {
        written = { repositoryRoot, evidence };
        return 'C:\\isolated-repository\\web_demo\\.generated-tests\\online\\latest.json';
      },
      now: () => new Date('2026-08-31T00:00:00.000Z'),
    });

    assert.equal(checksRun, 1);
    assert.equal(result.evidence.testedCommit, 'a'.repeat(40));
    assert.equal(written.evidence, result.evidence);
    assert.match(result.candidatePath, /\.generated-tests\\online\\latest\.json$/);
  });

  it('rejects a dirty tree before any network or browser checks run', async () => {
    let checksRun = false;
    await assert.rejects(
      runOnlineAcceptance(DEPLOYMENT_URL, {
        repositoryRoot: 'C:\\isolated-repository',
        inspectGit: async () => ({ head: 'a'.repeat(40), porcelain: '?? local-secret.txt\n' }),
        runChecks: async () => {
          checksRun = true;
          throw new Error('must not run');
        },
      }),
      /clean/i,
    );
    assert.equal(checksRun, false);
  });
});

// The authoritative suite above is pure node:test. The repository-wide Vitest
// command also discovers *.test.mjs, so register one compatibility sentinel
// only inside that runner; a plain `node --test` never imports Vitest.
if (process.env.VITEST) {
  const vitest = await import('vitest');
  vitest.describe('online acceptance node:test compatibility', () => {
    vitest.it('keeps the pure helper module import-safe', () => {
      assert.equal(parseOnlineUrl(DEPLOYMENT_URL), DEPLOYMENT_URL);
    });
  });
}
