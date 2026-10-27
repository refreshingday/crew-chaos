import { defineConfig } from 'vite';

export default defineConfig({
  // The same static build can live at an HTTPS root or a GitHub Pages subpath.
  base: './',
  build: { target: 'es2020' },
});
