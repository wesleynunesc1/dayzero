import { defineConfig } from 'vite';

// Caminhos relativos: o build em dist/ funciona servido de qualquer pasta.
export default defineConfig({
  base: './',
  server: { port: 5173, open: true },
});
