import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // workaround: il minifier CSS di Vite rompe il CSS di TinyMCE
  build: {
    cssMinify: false,
  },
  server: {
    // Docker su Windows: senza polling il live-reload non vede le modifiche
    watch: {
      usePolling: true,
      interval: 300,
    },
    // in dev non c'è Caddy: i PDF legali li serve il backend
    proxy: {
      '/legal-docs': {
        target: 'http://backend:8000',
        changeOrigin: true,
      },
    },
  },
})
