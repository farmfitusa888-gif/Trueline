import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { UnitsProvider } from './units.tsx';
import { reportTrouble } from './bridge.ts';
import './index.css';

/**
 * Anything that gets all the way out, written down.
 *
 * ## Why this is here and not in a component
 *
 * `docs/BUSINESS.md` §6 lists four ways this business fails and marks one of
 * them **certain** — being blind. The app now subscribes to MetricKit, which
 * fixes half of it: Apple reports native crashes and hangs.
 *
 * MetricKit sees native code and nothing else, and **most of this product is
 * not native code**. The takeoff, the plan, the elevation, the proposal, the
 * change order and the claim document all run in this bundle, and every one of
 * them can throw, leave a blank panel on the screen, and be completely
 * invisible to Apple's pipe. A contractor in a basement sees an empty rectangle
 * and concludes the app is broken, which it is, and nobody here ever learns it
 * happened.
 *
 * A React error boundary would not do this job either. A boundary catches what
 * happens during rendering; this catches everything else as well — a handler on
 * a button, a promise nobody awaited, a failure inside `setTimeout`.
 *
 * ## What it does not do
 *
 * It does not swallow anything. Neither handler calls `preventDefault`, so the
 * error still reaches the console exactly as it did before, and a browser with
 * no app around it is completely unchanged: `reportTrouble` finds no message
 * handler and returns.
 *
 * Nothing is sent anywhere. The app writes it to a file on the device, and it
 * leaves only when somebody taps Send them on the Business screen.
 */
window.addEventListener('error', (event) => {
  reportTrouble(
    event.error ?? event.message,
    // Which file and where in it. The bundle is minified, so this is a line in
    // a built asset rather than in the source -- still the fastest way to know
    // which screen it was, because the assets are named after their chunks.
    `${event.filename || 'unknown file'}:${event.lineno}:${event.colno}`
  );
});

window.addEventListener('unhandledrejection', (event) => {
  // A promise nobody awaited. This is the one that matters most in this app:
  // saving, the PDF, the ESX zip and every photograph are async, and a
  // rejection in any of them fails silently today.
  reportTrouble(event.reason, 'a promise nobody awaited');
});

const root = document.getElementById('root');
if (!root) throw new Error('No #root to mount into.');

createRoot(root).render(
  <StrictMode>
    <UnitsProvider>
      <App />
    </UnitsProvider>
  </StrictMode>
);
