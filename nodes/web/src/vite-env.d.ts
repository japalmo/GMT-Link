/// <reference types="vite/client" />

/**
 * Tipado estricto de las variables de entorno expuestas al cliente (VITE_*).
 * Todas viven en el `.env` de la raíz del monorepo (ver vite.config.ts → envDir).
 * Las opcionales pueden faltar según el entorno.
 */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
