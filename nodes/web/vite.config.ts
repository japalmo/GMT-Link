/// <reference types="vitest/config" />
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Las variables VITE_* viven en el `.env` de la raíz del monorepo (compartido
  // con la API), no en nodes/web. Apuntamos `envDir` ahí para que import.meta.env
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
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/three/') || id.includes('\\three\\')) return 'vendor-three';
          if (
            id.includes('/leaflet/') ||
            id.includes('\\leaflet\\') ||
            id.includes('/react-leaflet/') ||
            id.includes('\\react-leaflet\\')
          ) {
            return 'vendor-leaflet';
          }
          if (
            id.includes('/react-router-dom/') ||
            id.includes('\\react-router-dom\\') ||
            id.includes('/react-router/') ||
            id.includes('\\react-router\\')
          ) {
            return 'vendor-router';
          }
          if (
            id.includes('/react-dom/') ||
            id.includes('\\react-dom\\') ||
            id.includes('/react/') ||
            id.includes('\\react\\')
          ) {
            return 'vendor-react';
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
});
