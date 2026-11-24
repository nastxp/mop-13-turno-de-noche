import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// `vite build --mode artifact` genera un único módulo sin Phaser (que se carga desde cdnjs)
export default defineConfig(({ mode }) => ({
  base: './',
  resolve: mode === 'artifact'
    ? { alias: { phaser: fileURLToPath(new URL('./src/phaser-global.ts', import.meta.url)) } }
    : {},
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: 0,
    outDir: mode === 'artifact' ? 'dist-artifact' : 'dist',
  },
  // en desarrollo, el multijugador se reenvía al servidor de deploy/server.js (npm start en :3000)
  server: { port: 5173, strictPort: true, proxy: { '/mp': { target: 'http://localhost:3000', ws: true } } },
}));
