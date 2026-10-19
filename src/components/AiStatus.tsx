import { useEffect, useState } from 'react';
import { useAiWait } from '../lib/aiQueue';
import { ISparkle } from './Icons';

/** A small line while AI requests wait: on a rate limit (with the countdown), the connection, or their turn. */
export function AiStatus() {
  const wait = useAiWait();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (wait?.kind !== 'busy') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [wait]);
  if (!wait) return null;
  const secs = wait.until ? Math.max(0, Math.ceil((wait.until - now) / 1000)) : 0;
  const text =
    wait.kind === 'offline'
      ? `Offline — ${wait.provider} will carry on when you’re connected`
      : wait.kind === 'busy'
        ? `${wait.provider} is busy (free-tier limit) — trying again in ${secs}s`
        : 'Waiting for an earlier AI request to finish';
  return (
    <div className={`ai-status ${wait.kind}`} role="status" aria-live="polite">
      <ISparkle size={14} />
      <span>{text}</span>
    </div>
  );
}
