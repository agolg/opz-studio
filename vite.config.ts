import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Static app: `npm run build` → dist/, deployable on any HTTPS host.
// Web MIDI + SysEx require a secure context (HTTPS or localhost).
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
});
