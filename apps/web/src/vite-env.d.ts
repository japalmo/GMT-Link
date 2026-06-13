/// <reference types="vite/client" />

/**
 * Tipado estricto de las variables de entorno expuestas al cliente (VITE_*).
 * Todas viven en el `.env` de la raíz del monorepo (ver vite.config.ts → envDir).
 * Las opcionales pueden faltar en producción (p. ej. el emulador de Firebase).
 */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  /** Si está definida, el cliente se conecta al emulador de Auth (solo DEV). */
  readonly VITE_FIREBASE_AUTH_EMULATOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
