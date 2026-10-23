import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  // host: true lets phones and iPads on the same Wi-Fi open the game
  server: { host: true, port: 5173, fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
});
