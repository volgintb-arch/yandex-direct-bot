import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    // For local dev: forward API calls to the bot running on 3004.
    proxy: {
      '/api': 'http://127.0.0.1:3004',
    },
  },
});
