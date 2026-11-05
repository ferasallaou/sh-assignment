import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the page is served by Vite on :5173 and /api is forwarded to the backend's
// web API (npm run api, :3200), so the browser only ever talks to one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.API_PORT ?? 3200}`, changeOrigin: true } },
  },
});
