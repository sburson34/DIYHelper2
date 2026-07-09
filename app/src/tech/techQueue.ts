import AsyncStorage from '@react-native-async-storage/async-storage';
import { techUpdateJob, TechJob, TechJobPatch } from '../api/backendClient';

// Offline resilience for tech-mode job updates. Techs work in basements and dead
// zones, so every status change / photo / signature is written to a local queue
// first and flushed to the server when connectivity allows. The UI updates
// optimistically off the same queue, so a tech never loses work to a bad signal.

const QUEUE_KEY = '@tech_queue';       // { [jobId]: mergedPatch }
const JOBS_CACHE_KEY = '@tech_jobs_cache';

type QueueMap = Record<string, TechJobPatch>;

const readQueue = async (): Promise<QueueMap> => {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueueMap) : {};
  } catch {
    return {};
  }
};

const writeQueue = async (q: QueueMap): Promise<void> => {
  try { await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* best-effort */ }
};

// Merge a patch for a job into the queue (later fields win). Returns the merged
// patch so the caller can update its optimistic view.
export const enqueuePatch = async (jobId: number | string, patch: TechJobPatch): Promise<TechJobPatch> => {
  const q = await readQueue();
  const merged = { ...(q[String(jobId)] || {}), ...patch };
  q[String(jobId)] = merged;
  await writeQueue(q);
  return merged;
};

export const pendingPatch = async (jobId: number | string): Promise<TechJobPatch | null> => {
  const q = await readQueue();
  return q[String(jobId)] || null;
};

export const pendingCount = async (): Promise<number> => Object.keys(await readQueue()).length;

// Try to push every queued patch. Succeeded entries are removed; failures stay
// for the next flush. Safe to call repeatedly (on app foreground, screen focus,
// after each save). Returns how many synced.
export const flushQueue = async (): Promise<number> => {
  const q = await readQueue();
  const ids = Object.keys(q);
  if (!ids.length) return 0;
  let flushed = 0;
  for (const id of ids) {
    try {
      await techUpdateJob(id, q[id]);
      delete q[id];
      flushed++;
    } catch {
      // Leave it queued — likely offline or a transient error.
    }
  }
  await writeQueue(q);
  return flushed;
};

// Cache the job list so the tech sees their day instantly (and offline).
export const saveJobsCache = async (jobs: TechJob[]): Promise<void> => {
  try { await AsyncStorage.setItem(JOBS_CACHE_KEY, JSON.stringify(jobs)); } catch { /* best-effort */ }
};

export const getJobsCache = async (): Promise<TechJob[]> => {
  try {
    const raw = await AsyncStorage.getItem(JOBS_CACHE_KEY);
    return raw ? (JSON.parse(raw) as TechJob[]) : [];
  } catch {
    return [];
  }
};

export const clearTechCache = async (): Promise<void> => {
  try { await AsyncStorage.multiRemove([QUEUE_KEY, JOBS_CACHE_KEY]); } catch { /* best-effort */ }
};
