import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  shims: true,
  clean: true,
  minify: false,
  sourcemap: true,
  dts: false,
});