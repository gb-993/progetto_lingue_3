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
})
