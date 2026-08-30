import { lstat, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILD_TEXT_PATHS = [
  'index.html',
  'public/brands/README.md',
  'public/brands/github-mark.svg',
  'public/fonts/OFL-League-Gothic.txt',
];

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function defaultWebDemoRoot() {
  return fileURLToPath(new URL('../', import.meta.url));
}

async function normalizeTextFile(webDemoRoot, relativePath) {
  const targetPath = resolve(webDemoRoot, relativePath);
  if (!targetPath.startsWith(`${webDemoRoot}${sep}`)) {
    throw new Error(`Build text path escapes the WebDemo directory: ${relativePath}`);
  }

  const stats = await lstat(targetPath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`Build text input must be a regular file: ${relativePath}`);
  }

  const original = await readFile(targetPath, 'utf8');
  const normalized = original.replace(/\r\n?/g, '\n');
  if (normalized === original) {
    return false;
  }

  await writeFile(targetPath, normalized, 'utf8');
  return true;
}

async function main() {
  const webDemoRoot = resolve(process.argv[2] ?? defaultWebDemoRoot());
  let changedFiles = 0;
  for (const relativePath of BUILD_TEXT_PATHS) {
    if (await normalizeTextFile(webDemoRoot, relativePath)) {
      changedFiles += 1;
    }
  }
  process.stdout.write(`[build-text] normalized ${changedFiles} input asset(s) to LF\n`);
}

main().catch((error) => {
  process.stderr.write(`[build-text] ${errorMessage(error)}\n`);
  process.exitCode = 1;
});
