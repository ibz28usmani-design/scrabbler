import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { anyJobsRunning, initDb } from './db';
import './styles.css';

// An update waits until the app is put away with nothing recording or being
// transcribed in any tab, rather than reloading mid-lecture or mid-sentence.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    const apply = async () => {
      if (document.visibilityState !== 'hidden') return;
      // It reloads every open tab, so no tab may be recording or mid-job; and
      // look again after the wait, in case the app came back meanwhile.
      const busy = await anyJobsRunning().catch(() => true);
      if (!busy && document.visibilityState === 'hidden') void updateSW(true);
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
