import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../api/backendClient', () => ({
  techUpdateJob: jest.fn(),
}));

import { techUpdateJob } from '../api/backendClient';
import {
  enqueuePatch, pendingPatch, pendingCount, flushQueue,
  saveJobsCache, getJobsCache, clearTechCache,
} from '../tech/techQueue';

const mockUpdate = techUpdateJob as jest.Mock;

describe('techQueue', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockUpdate.mockReset();
  });

  test('enqueuePatch merges consecutive patches, later fields win', async () => {
    await enqueuePatch(7, { status: 'on_the_way', techEtaMinutes: 20 });
    const merged = await enqueuePatch(7, { techEtaMinutes: 10, completionNotes: 'note' });

    expect(merged).toEqual({ status: 'on_the_way', techEtaMinutes: 10, completionNotes: 'note' });
    expect(await pendingPatch(7)).toEqual(merged);
    expect(await pendingCount()).toBe(1);
  });

  test('flushQueue pushes every queued job and clears successes', async () => {
    mockUpdate.mockResolvedValue({});
    await enqueuePatch(1, { status: 'in_progress' });
    await enqueuePatch(2, { status: 'completed' });

    const flushed = await flushQueue();

    expect(flushed).toBe(2);
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(await pendingCount()).toBe(0);
  });

  test('flushQueue keeps failed entries queued for the next attempt', async () => {
    mockUpdate
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({});
    await enqueuePatch(1, { status: 'in_progress' });
    await enqueuePatch(2, { status: 'completed' });

    const flushed = await flushQueue();

    expect(flushed).toBe(1);
    expect(await pendingCount()).toBe(1);

    // Connectivity restored — the survivor flushes on the next call.
    const second = await flushQueue();
    expect(second).toBe(1);
    expect(await pendingCount()).toBe(0);
  });

  test('jobs cache round-trips and clearTechCache wipes queue + cache', async () => {
    await saveJobsCache([{ id: 1, projectTitle: 'Job', status: 'new' }] as never);
    await enqueuePatch(1, { status: 'in_progress' });

    expect((await getJobsCache())).toHaveLength(1);

    await clearTechCache();
    expect(await getJobsCache()).toEqual([]);
    expect(await pendingCount()).toBe(0);
  });
});
