import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App.tsx';
import { initAndroidApp, isAndroidApp } from './native.ts';
import { initStore } from './store.ts';
import './styles.css';

// The Android app bundles its screens, so it has no service worker.
if (isAndroidApp) initAndroidApp();
else registerSW({ immediate: true });
void initStore();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
