import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // TinyMCE ships CSS using `:nth-child(An of <selector>)` which lightningcss
  // (Vite's default CSS minifier in v8+) currently mis-parses. Fall back to
  // esbuild's CSS minifier, which handles it correctly.
  build: {
    cssMinify: false,
  },
  server: {
    // In dev non c'e' Caddy davanti, quindi le rotte non-SPA come
    // /legal-docs/* (PDF dei documenti legali caricati via UI admin)
    // restano scoperte: il browser le chiederebbe a Vite (5173) e
    // riceverebbe 404. Proxie a backend (8000), che ha un endpoint
    // dedicato che serve i file da LEGAL_DOCUMENTS_DIR. In prod questo
    // proxy non e' attivo (npm run build non lo legge) e Caddy intercetta
    // /legal-docs/* PRIMA del backend, servendo direttamente dal volume.
    proxy: {
      '/legal-docs': {
        target: 'http://backend:8000',
        changeOrigin: true,
      },
    },
  },
})
