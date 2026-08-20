import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Builds the browser app into `dist/app`, which the server serves.
 *
 * Everything is inlined into the bundle: the runner UI must work on a machine
 * with no network, and a CI box opening a trace has no business fetching a font
 * from a CDN.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: fileURLToPath(new URL('./src/app', import.meta.url)),
  base: './',
  build: {
    // The normal server build keeps branding as a real reusable SVG asset.
    // `inline-report.ts` alone turns emitted assets into data URLs when it
    // packages the same application as one self-contained HTML document.
    assetsInlineLimit: 0,
    outDir: fileURLToPath(new URL('./dist/app', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    rollupOptions: { input: fileURLToPath(new URL('./src/app/index.html', import.meta.url)) },
  },
});
