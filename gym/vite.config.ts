import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  // Relative, not '/gym/': the single inlined file is served both at /gym/ on the main app's
  // host and at / on gymtracker.<domain> (nginx maps / to /gym/ there). Relative URLs resolve
  // correctly at either mount, which the manifest and icons in public/ depend on.
  base: './',
  server: {
    // In dev the app runs on its own Vite port, so /api calls have to reach the
    // 12wyapp server for the session cookie and gym endpoints to work.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: false,
      },
    },
  },
})
