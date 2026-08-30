import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error) {
  return error !== null && typeof error === 'object' && 'code' in error
    ? error.code
    : undefined;
}

export function defaultOnlineDistDirectory() {
  return fileURLToPath(new URL('../dist-online/', import.meta.url));
}

/** Reject an unsafe pre-existing Vite output before Vite can empty it. */
export async function preflightOnlineBuild(distDirectory = defaultOnlineDistDirectory()) {
  if (typeof distDirectory !== 'string' || distDirectory.trim() === '') {
    throw new TypeError('Online dist directory must be a non-empty path');
  }
  const outputDirectory = resolve(distDirectory);
  let stats;
  try {
    stats = await lstat(outputDirectory);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return;
    }
    throw new Error(`Could not inspect online dist directory: ${errorMessage(error)}`);
  }
  if (stats.isSymbolicLink()) {
    throw new Error(
      `Online dist directory must not be a symlink or junction before Vite builds: ${outputDirectory}`,
    );
  }
  if (!stats.isDirectory()) {
    throw new Error(`Online dist path must be a regular directory: ${outputDirectory}`);
  }
}

async function runCli() {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length > 1) {
    throw new Error('Usage: node tools/preflight_online_build.mjs [dist-directory]');
  }
  await preflightOnlineBuild(arguments_[0]);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  try {
    await runCli();
  } catch (error) {
    console.error(`[online-preflight] ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
