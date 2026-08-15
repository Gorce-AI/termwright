import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Builds the browser app into `dist/app`, which the server serves.
 *
 * Everything is inlined into the bundle: the runner UI must work on a machine
 * with no network, and a CI box opening a trace has no business fetching a font
 * from a CDN.
 */
export default defineConfig({
  root: fileURLToPath(new URL('./src/app', import.meta.url)),
  base: './',
  build: {
    outDir: fileURLToPath(new URL('./dist/app', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    rollupOptions: { input: fileURLToPath(new URL('./src/app/index.html', import.meta.url)) },
  },
});
