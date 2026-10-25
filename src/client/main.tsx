import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App.tsx';
import { refreshPushSubscription } from './push.ts';
import { initStore } from './store.ts';
import './styles.css';

registerSW({ immediate: true });
void initStore();
void refreshPushSubscription();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
