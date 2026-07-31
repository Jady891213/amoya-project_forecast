import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

function finalizePortableHtml(): Plugin {
  return {
    name: 'finalize-portable-html',
    enforce: 'post',
    async closeBundle() {
      const outputDirectory = join(process.cwd(), 'dist-singlefile')
      const htmlPath = join(outputDirectory, 'index.html')
      let html = await readFile(htmlPath, 'utf8')
      const files = await readdir(outputDirectory)
      for (const filename of files) {
        if (/^sqlite3-worker1-.*\.js$/.test(filename)) {
          const worker = await readFile(join(outputDirectory, filename))
          const dataUrl = `data:text/javascript;base64,${worker.toString('base64')}`
          html = html.replaceAll(filename, dataUrl)
        }
      }
      await writeFile(htmlPath, html)
      for (const filename of files) {
        if (filename !== 'index.html') {
          await rm(join(outputDirectory, filename), { recursive: true, force: true })
        }
      }
    },
  }
}

export default defineConfig({
  base: './',
  define: {
    __PORTABLE_MODE__: true,
    __SERVICE_MODE__: false,
  },
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  plugins: [
    react(),
    viteSingleFile(),
    finalizePortableHtml(),
  ],
  build: {
    outDir: 'dist-singlefile',
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: Number.POSITIVE_INFINITY,
  },
})
