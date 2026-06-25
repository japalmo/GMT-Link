import { defineConfig } from 'vitest/config';

export default defineConfig({
  // NestJS usa decoradores legacy + metadata; esbuild (transformer de vitest) los
  // soporta vía tsconfigRaw, evitando depender de ts-jest/swc.
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
    },
  },
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
