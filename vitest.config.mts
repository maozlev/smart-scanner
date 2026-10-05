import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // the engine and audit suites are CPU-heavy and run in parallel with the light ones
  test: { include: ['src/**/*.test.ts'], testTimeout: 120_000 },
});
