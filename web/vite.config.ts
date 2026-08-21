import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The core package is imported straight from source rather than through a build
// step. There is one copy of the measurement code and the browser runs the same
// file the tests do — no compiled artefact to drift.
export default defineConfig({
  plugins: [react()],
  server: { host: true },
  // Relative asset paths, because this bundle is loaded two ways: from a web
  // server, and from inside the iOS app where the page is not at the root of
  // anything. An absolute `/assets/index.js` resolves to the root of the
  // device's filesystem there, and the app opens on a white screen.
  base: './',
});
