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

function serializedObjectKeys(value: unknown): string[] {
  const keys: string[] = [];

  JSON.parse(JSON.stringify(value), (key: string, nestedValue: unknown) => {
    if (key !== '') {
      keys.push(key);
    }
    return nestedValue;
  });

  return keys;
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
    const serializedKeys = serializedObjectKeys(await readConfig());
    const forbiddenKeys = serializedKeys.filter((key) => {
      const normalized = key.toLowerCase();
      return (
        FORBIDDEN_METADATA_KEYS.has(normalized) ||
        /(?:^|[_-])(?:token|secret)(?:$|[_-])/i.test(key)
      );
    });

    expect(forbiddenKeys).toEqual([]);
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
      'x-vercel-enable-rewrite-caching': '1',
      'Cache-Control': IMMUTABLE,
      'Vercel-CDN-Cache-Control': IMMUTABLE,
    });
  });
});
