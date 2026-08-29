import { createReadStream } from 'node:fs';
import { access, mkdir, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const benchmarkRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(benchmarkRoot, '..');
const edgeExecutable =
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const resultPath = join(
  repositoryRoot,
  'results',
  'web_model_experiment',
  'browser_runtime_results.json',
);

const MIME_TYPES = {
  '.bin': 'application/octet-stream',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.onnx': 'application/octet-stream',
  '.wasm': 'application/wasm',
};

const runs = [
  { variant: 'fp32', ep: 'webgpu', fixture: 'demo', timeoutMs: 180_000 },
  { variant: 'fp16', ep: 'webgpu', fixture: 'demo', timeoutMs: 180_000 },
  { variant: 'int8', ep: 'webgpu', fixture: 'demo', timeoutMs: 180_000 },
  { variant: 'fp32', ep: 'wasm', fixture: 'demo', timeoutMs: 180_000 },
  { variant: 'int8', ep: 'wasm', fixture: 'demo', timeoutMs: 180_000 },
];

const extendedFixtureFiles = [
  join(repositoryRoot, 'web_models', 'extended_inputs.json'),
  join(repositoryRoot, 'web_models', 'extended_inputs_f32.bin'),
];
try {
  await Promise.all(extendedFixtureFiles.map((filePath) => access(filePath)));
  runs.push(
    { variant: 'fp16', ep: 'webgpu', fixture: 'extended', timeoutMs: 180_000 },
    { variant: 'int8', ep: 'wasm', fixture: 'extended', timeoutMs: 180_000 },
  );
} catch {
  // The anonymous extended fixture is local-only; the committed demo fixture is mandatory.
}

function resolveRequestPath(urlPath) {
  if (urlPath.startsWith('/models/')) {
    return {
      root: join(repositoryRoot, 'web_models'),
      relative: urlPath.slice('/models/'.length),
    };
  }
  if (urlPath.startsWith('/node_modules/')) {
    return {
      root: join(benchmarkRoot, 'node_modules'),
      relative: urlPath.slice('/node_modules/'.length),
    };
  }
  return {
    root: benchmarkRoot,
    relative:
      urlPath === '/' ? 'benchmark.html' : urlPath.replace(/^\//, ''),
  };
}

const server = createServer(async (request, response) => {
  try {
    const urlPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const { root, relative } = resolveRequestPath(urlPath);
    const rootPath = resolve(root);
    const filePath = resolve(rootPath, normalize(relative));
    if (!filePath.startsWith(`${rootPath}\\`) && filePath !== rootPath) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }

    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': fileStats.size,
      'Content-Type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
  }
});

await new Promise((resolveListening) => {
  server.listen(8765, '127.0.0.1', resolveListening);
});

const browser = await chromium.launch({
  executablePath: edgeExecutable,
  headless: true,
  args: ['--enable-unsafe-webgpu'],
});

const results = [];
try {
  for (const run of runs) {
    const page = await browser.newPage();
    const consoleMessages = [];
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) {
        consoleMessages.push(`${message.type()}: ${message.text()}`);
      }
    });

    const url =
      `http://127.0.0.1:8765/benchmark.html?variant=${run.variant}` +
      `&ep=${run.ep}&fixture=${run.fixture}`;
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
      await page.waitForFunction(
        () => window.__benchmarkResult || window.__benchmarkError,
        null,
        { timeout: run.timeoutMs },
      );
      const outcome = await page.evaluate(() => ({
        result: window.__benchmarkResult ?? null,
        error: window.__benchmarkError ?? null,
      }));
      results.push({
        ...run,
        ...outcome,
        console_messages: consoleMessages,
      });
    } catch (error) {
      results.push({
        ...run,
        result: null,
        error: { name: error.name, message: error.message },
        console_messages: consoleMessages,
      });
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  await new Promise((resolveClosed) => server.close(resolveClosed));
}

const report = {
  generated_at: new Date().toISOString(),
  browser: 'Microsoft Edge',
  browser_executable: edgeExecutable,
  onnxruntime_web: '1.29.0',
  runs: results,
};
await mkdir(dirname(resultPath), { recursive: true });
await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
