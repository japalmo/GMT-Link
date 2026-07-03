// Registro global de los matchers de Testing Library (toBeInTheDocument,
// toBeChecked, toBeDisabled, …) para todas las suites de vitest. Se carga vía
// `test.setupFiles` en vite.config.ts. jest-dom extiende `expect` de vitest
// automáticamente al importarse.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Sin `globals: true` en vite.config, el auto-cleanup de Testing Library no se
// registra solo: lo hacemos acá para desmontar el DOM entre tests y evitar
// nodos duplicados (p. ej. varios checkboxes con el mismo rol/nombre).
afterEach(() => {
  cleanup();
});
