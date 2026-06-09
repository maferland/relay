import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Build the UI to one self-contained dist/ui/index.html so the `tasks ui` server (and the
// compiled binary) can serve it without separate asset files.
export default defineConfig({
  root: 'ui',
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
  },
})
