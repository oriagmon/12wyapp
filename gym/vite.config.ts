import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  // The build is a single inlined file served from /gym/ by the 12wyapp server.
  base: '/gym/',
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
