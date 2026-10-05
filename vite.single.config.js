// Builds everything into one self-contained page (used for the chat preview).
import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { outDir: 'dist-single', target: 'es2022', assetsInlineLimit: 100000000, cssCodeSplit: false, modulePreload: false, chunkSizeWarningLimit: 5000, rollupOptions: { output: { inlineDynamicImports: true } } },
});
