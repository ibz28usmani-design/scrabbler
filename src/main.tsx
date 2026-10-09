import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { initDb } from './db';
import './styles.css';

registerSW({ immediate: true });

// Ask the browser not to evict local data (granted automatically for Home Screen apps).
navigator.storage?.persist?.().catch(() => {});

initDb()
  .catch((e) => console.error('DB init failed', e))
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
