/**
 * Claims on long jobs — a recording, a transcription, a source being read, a
 * studio item — held as Web Locks for as long as they run. Other tabs can see
 * them: one starting up leaves a claimed job alone, and an update (which
 * reloads every tab) waits until there are none.
 */

export const JOB_LOCK = 'scrabbler-job:';
export const locks = () => (typeof navigator !== 'undefined' ? navigator.locks : undefined);
let jobs = 0;

/** Long jobs this tab is running now. */
export const runningJobs = () => jobs;

/** Whether any tab is running a long job. */
export async function anyJobsRunning(): Promise<boolean> {
  if (jobs > 0) return true;
  const l = locks();
  if (!l) return false;
  const { held = [] } = await l.query();
  return held.some((h) => h.name?.startsWith(JOB_LOCK));
}

/** Claims a job for this tab while it runs. Returns the function that ends the claim. */
export function holdJob(id: string): () => void {
  jobs++;
  let release!: () => void;
  const done = new Promise<void>((r) => (release = r));
  locks()?.request(JOB_LOCK + id, () => done).catch(() => {});
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    jobs--;
    release();
  };
}
