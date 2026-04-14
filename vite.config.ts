import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['adacad-drafting-lib', 'adacad-drafting-lib/loom', 'adacad-drafting-lib/draft'],
  },
})
