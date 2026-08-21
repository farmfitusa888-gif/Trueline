import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The core package is imported straight from source rather than through a build
// step. There is one copy of the measurement code and the browser runs the same
// file the tests do — no compiled artefact to drift.
export default defineConfig({
  plugins: [react()],
  server: { host: true },
});
