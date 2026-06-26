import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/erddap': {
        target: 'https://erddap.incois.gov.in',
        changeOrigin: true,
        secure: false // Ignore self-signed/expired SSL certificates
      }
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
});
