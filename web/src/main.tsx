import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { UnitsProvider } from './units.tsx';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('No #root to mount into.');

createRoot(root).render(
  <StrictMode>
    <UnitsProvider>
      <App />
    </UnitsProvider>
  </StrictMode>
);
