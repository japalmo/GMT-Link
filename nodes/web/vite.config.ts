/// <reference types="vitest/config" />
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Las variables VITE_* viven en el `.env` de la raíz del monorepo (compartido
  // con la API), no en apps/web. Apuntamos `envDir` ahí para que import.meta.env
  // resuelva VITE_API_URL y VITE_FIREBASE_* (§ tarea 0.5/0.7).
  envDir: path.resolve(__dirname, '../..'),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
  test: {
    environment: 'jsdom',
  },
});
