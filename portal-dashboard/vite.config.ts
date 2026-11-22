import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds one self-contained bundle that the portal loads into the "Tablero" tab.
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: '../api/public/dash',
    emptyOutDir: true,
    cssCodeSplit: false,
    minify: 'esbuild',
    lib: { entry: 'src/main.tsx', name: 'BeemoDashboard', formats: ['iife'], fileName: () => 'dashboard.js' },
    rollupOptions: { output: { assetFileNames: 'dashboard[extname]' } },
  },
});
