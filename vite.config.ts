import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  define: {
    __PORTABLE_MODE__: false,
    __SERVICE_MODE__: true,
  },
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
