import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8787' } },
  // `npm start` serves the build through a Cloudflare quick tunnel; preview reuses server.proxy.
  preview: { allowedHosts: ['.trycloudflare.com'] },
})
