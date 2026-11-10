import { defineConfig } from 'vite';

// `base` is relative so the built site works from any path: GitHub Pages
// project sites live at /booster-catch/, Cloudflare Pages at the root.
export default defineConfig({
  base: './',
  server: { port: 5180, strictPort: true },
  preview: { port: 5181 },
  build: { target: 'es2022', sourcemap: true },
});
