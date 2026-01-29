import { defineConfig } from 'tsup';

export default defineConfig([
  // Library build
  {
    entry: {
      index: 'src/index.ts',
    },
    format: ['esm'],
    target: 'node18',
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    shims: true,
  },
  // CLI build with shebang
  {
    entry: {
      cli: 'src/cli.ts',
    },
    format: ['esm'],
    target: 'node18',
    sourcemap: true,
    splitting: false,
    shims: true,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);
