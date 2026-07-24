import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    // allow access from LAN and use the same origin for proxying
    host: true,
    allowedHosts: true,

    proxy: {
      // proxy any /api request to the backend running on localhost:4000
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      },
      // proxy /upload to the backend as well
      '/upload': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
