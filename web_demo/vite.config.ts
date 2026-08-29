import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const ORT_RUNTIME_NAME = 'ort-wasm-simd-threaded.asyncify.wasm';

export function runtimeAssetFileName(asset: {
  name?: string | undefined;
  names?: readonly string[] | undefined;
}): string {
  const assetNames = asset.names ?? [];
  const names = asset.name === undefined ? assetNames : [asset.name, ...assetNames];
  return names.includes(ORT_RUNTIME_NAME)
    ? `assets/${ORT_RUNTIME_NAME}`
    : 'assets/[name]-[hash][extname]';
}

export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        assetFileNames: runtimeAssetFileName,
      },
    },
  },
  test: {
    environment: 'node',
  },
});
