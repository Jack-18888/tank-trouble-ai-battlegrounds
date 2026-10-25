import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/.qa/**', '**/.sites-runtime/**'] },
  },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
});
