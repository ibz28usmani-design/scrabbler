import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { initDb } from './db';
import { isRecording } from './lib/audio';
import './styles.css';

// An update waits until the app is put away and nothing is recording, rather than
// reloading mid-lecture or mid-sentence.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    const apply = () => {
      if (document.visibilityState === 'hidden' && !isRecording()) void updateSW(true);
    };
    document.addEventListener('visibilitychange', apply);
  },
});

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
