import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';

function mountBridgeRoot() {
  let rootEl = document.getElementById('firebaseRoot');
  if (!rootEl) {
    rootEl = document.createElement('div');
    rootEl.id = 'firebaseRoot';
    document.body.appendChild(rootEl);
  }
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountBridgeRoot);
} else {
  mountBridgeRoot();
}
