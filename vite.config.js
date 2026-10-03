import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const pages = ['index', 'projects', 'versions', 'logs', 'console', 'settings', 'components'];

export default defineConfig({
  // Relative asset URLs so the build works on GitHub Pages, Netlify or a subfolder alike.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(pages.map(name => [name, resolve(__dirname, `${name}.html`)])),
    },
  },
});
