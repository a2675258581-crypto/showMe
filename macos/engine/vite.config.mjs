import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  root: here('.'),
  logLevel: 'warn',
  build: {
    lib: {
      entry: here('./engine.js'),
      formats: ['iife'],
      name: 'ShowMeEngineBundle',
      fileName: () => 'showme-engine.js',
    },
    outDir: here('../Resources/engine'),
    emptyOutDir: true,
    target: 'es2020',
    minify: true,
    sourcemap: false,
    rolldownOptions: {
      output: {
        banner: readFileSync(here('./polyfills.js'), 'utf8'),
        codeSplitting: false,
        minify: { codegen: { asciiOnly: true } },
      },
    },
  },
})
