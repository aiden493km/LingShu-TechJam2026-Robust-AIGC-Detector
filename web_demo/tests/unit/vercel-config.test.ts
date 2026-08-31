import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const MODEL_SOURCE = '/models/baseline2_njr_fp32.onnx';
const MODEL_HASH = 'e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69';
const MODEL_DESTINATION =
  'https://ruv1f22gd5afyug3.public.blob.vercel-storage.com/models/baseline2_njr_fp32-e2cdc94a06a7a7f72c763d46a92ef3ce84675fd9ae6a4664c94c6f5d99b66b69.onnx';
const REVALIDATE = 'public, max-age=0, must-revalidate';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const ALLOWED_TOP_LEVEL_KEYS = [
  '$schema',
  'framework',
  'installCommand',
  'buildCommand',
  'outputDirectory',
  'rewrites',
  'headers',
] as const;
const FORBIDDEN_METADATA_KEYS = new Set([
  'blob_read_write_token',
  'vercel_oidc_token',
  'token',
  'secret',
  'projectid',
  'orgid',
]);

type Header = {
  key: string;
  value: string;
};

type HeaderRule = {
  source: string;
  headers: Header[];
};

type Rewrite = {
  source: string;
  destination: string;
};

type VercelConfig = Record<string, unknown> & {
  $schema?: string;
  framework?: string;
  installCommand?: string;
  buildCommand?: string;
  outputDirectory?: string;
  rewrites?: Rewrite[];
  headers?: HeaderRule[];
  redirects?: unknown;
  functions?: unknown;
};

async function readConfig(): Promise<VercelConfig> {
  return JSON.parse(
    await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'),
  ) as VercelConfig;
}

function isForbiddenMetadataKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    FORBIDDEN_METADATA_KEYS.has(normalized) ||
    /(?:^|[_-])(?:token|secret)(?:$|[_-])/i.test(key)
  );
}

function forbiddenMetadataKeys(value: unknown, parentPath: string[] = []): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      forbiddenMetadataKeys(entry, [...parentPath, String(index)]),
    );
  }
  if (value === null || typeof value !== 'object') {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => {
    const currentPath = [...parentPath, key];
    return [
      ...(isForbiddenMetadataKey(key) ? [currentPath.join('.')] : []),
      ...forbiddenMetadataKeys(nestedValue, currentPath),
    ];
  });
}

function headerMapFor(rules: HeaderRule[], source: string): Record<string, string> {
  const rule = rules.find((candidate) => candidate.source === source);
  expect(rule, `missing header rule for ${source}`).toBeDefined();
  expect(new Set(rule?.headers.map(({ key }) => key)).size).toBe(rule?.headers.length);

  return Object.fromEntries(rule?.headers.map(({ key, value }) => [key, value]) ?? []);
}

describe('Vercel online delivery configuration', () => {
  it('allows only the reviewed top-level deployment keys', async () => {
    const config = await readConfig();

    expect(Object.keys(config).sort()).toEqual([...ALLOWED_TOP_LEVEL_KEYS].sort());
    expect(config).not.toHaveProperty('env');
    expect(config).not.toHaveProperty('functions');
    expect(config).not.toHaveProperty('redirects');
  });

  it('contains no serialized secret or Vercel project metadata keys', async () => {
    expect(forbiddenMetadataKeys(await readConfig())).toEqual([]);
  });

  it('reports nested forbidden metadata paths without returning fixture values', () => {
    const fakeValues = [
      'FAKE-BLOB-SECRET-NEVER-USE-71D4',
      'FAKE-OIDC-SECRET-NEVER-USE-82E5',
      'FAKE-PROJECT-ID-NEVER-USE-93F6',
      'FAKE-ORG-ID-NEVER-USE-A407',
      'FAKE-TOKEN-NEVER-USE-B518',
      'FAKE-GENERIC-SECRET-NEVER-USE-C629',
    ];
    const controlledFixture = {
      environment: {
        BLOB_READ_WRITE_TOKEN: fakeValues[0],
      },
      deployment: {
        nested: [
          { VERCEL_OIDC_TOKEN: fakeValues[1] },
          { projectId: fakeValues[2], orgId: fakeValues[3] },
        ],
        credentials: { token: fakeValues[4], secret: fakeValues[5] },
      },
      publicModel: { destination: MODEL_DESTINATION },
    };

    const findings = forbiddenMetadataKeys(controlledFixture);
    const expectedFindings = [
      'environment.BLOB_READ_WRITE_TOKEN',
      'deployment.nested.0.VERCEL_OIDC_TOKEN',
      'deployment.nested.1.projectId',
      'deployment.nested.1.orgId',
      'deployment.credentials.token',
      'deployment.credentials.secret',
    ];
    const serializedFindings = JSON.stringify(findings);

    expect({
      everyExpectedPathFound: expectedFindings.every((path) => findings.includes(path)),
      onlyExpectedPathsFound: findings.every((path) => expectedFindings.includes(path)),
      findingCountMatches: findings.length === expectedFindings.length,
      fixtureValuesRedacted: fakeValues.every((value) => !serializedFindings.includes(value)),
    }).toEqual({
      everyExpectedPathFound: true,
      onlyExpectedPathsFound: true,
      findingCountMatches: true,
      fixtureValuesRedacted: true,
    });

    let failureMessage = '';
    try {
      expect(findings).toEqual([]);
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error);
    }
    expect({
      failureCaptured: failureMessage.length > 0,
      fixtureValuesRedacted: fakeValues.every((value) => !failureMessage.includes(value)),
    }).toEqual({ failureCaptured: true, fixtureValuesRedacted: true });
  });

  it('uses the isolated online Vite build output', async () => {
    const config = await readConfig();

    expect(config).toMatchObject({
      $schema: 'https://openapi.vercel.sh/vercel.json',
      framework: 'vite',
      installCommand: 'npm ci',
      buildCommand: 'npm run build:online',
      outputDirectory: 'dist-online',
    });
  });

  it('rewrites only the frozen model path to the exact public Blob object', async () => {
    const config = await readConfig();

    expect(config).not.toHaveProperty('redirects');
    expect(config).not.toHaveProperty('functions');
    expect(config.rewrites).toEqual([
      {
        source: MODEL_SOURCE,
        destination: MODEL_DESTINATION,
      },
    ]);
    expect(config.rewrites?.[0]?.source).not.toMatch(/[():*]/);

    const destination = new URL(config.rewrites?.[0]?.destination ?? '');
    expect(destination.protocol).toBe('https:');
    expect(destination.hostname).toBe('ruv1f22gd5afyug3.public.blob.vercel-storage.com');
    expect(destination.pathname).toBe(
      `/models/baseline2_njr_fp32-${MODEL_HASH}.onnx`,
    );
    expect(destination.search).toBe('');
    expect(destination.hash).toBe('');
    expect(destination.href).toBe(MODEL_DESTINATION);
  });

  it('sets the exact global isolation and browser security headers', async () => {
    const config = await readConfig();
    const rules = config.headers ?? [];

    expect(headerMapFor(rules, '/(.*)')).toEqual({
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
  });

  it('sets exact browser and Vercel CDN caching per route', async () => {
    const config = await readConfig();
    const rules = config.headers ?? [];
    const expectedSources = ['/(.*)', '/', '/models/manifest.json', '/assets/:path*', MODEL_SOURCE];

    expect(rules.map(({ source }) => source).sort()).toEqual(expectedSources.sort());
    expect(new Set(rules.map(({ source }) => source)).size).toBe(rules.length);
    expect(headerMapFor(rules, '/')).toEqual({
      'Cache-Control': REVALIDATE,
      'Vercel-CDN-Cache-Control': REVALIDATE,
    });
    expect(headerMapFor(rules, '/models/manifest.json')).toEqual({
      'Cache-Control': REVALIDATE,
      'Vercel-CDN-Cache-Control': REVALIDATE,
    });
    expect(headerMapFor(rules, '/assets/:path*')).toEqual({
      'Cache-Control': IMMUTABLE,
      'Vercel-CDN-Cache-Control': IMMUTABLE,
    });
    expect(headerMapFor(rules, MODEL_SOURCE)).toEqual({
      'Cache-Control': IMMUTABLE,
      'Vercel-CDN-Cache-Control': IMMUTABLE,
    });
  });
});
