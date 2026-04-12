import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  saveToHoneyDoList,
  getHoneyDoList,
  updateHoneyDoList,
  removeFromHoneyDoList,
  saveToContractorList,
  getContractorList,
  updateContractorList,
  removeFromContractorList,
  saveUserProfile,
  getUserProfile,
  getToolInventory,
  addToInventory,
  removeFromInventory,
  getShoppingBought,
  setShoppingBought,
  getAppPrefs,
  setAppPrefs,
  getCachedAnalysis,
  setCachedAnalysis,
  getLocalHelpRequests,
  saveLocalHelpRequest,
  updateLocalHelpRequest,
  getMostRecentProject,
  getCommunityOptIn,
  setCommunityOptIn,
  migrateProject,
  PROJECT_SCHEMA_VERSION,
} from '../utils/storage';

beforeEach(() => {
  jest.clearAllMocks();
  AsyncStorage._reset();
});

// ── migrateProject ──────────────────────────────────────────────
describe('migrateProject', () => {
  it('returns null/non-object inputs unchanged', () => {
    expect(migrateProject(null)).toBeNull();
    expect(migrateProject(undefined)).toBeUndefined();
    expect(migrateProject('string')).toBe('string');
  });

  it('does not re-migrate a current-version project', () => {
    const project = { id: '1', schemaVersion: PROJECT_SCHEMA_VERSION, title: 'Test' };
    expect(migrateProject(project)).toBe(project); // same reference
  });

  it('adds missing v2 fields', () => {
    const old = { id: '1', title: 'Old project' };
    const migrated = migrateProject(old);
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.weatherWindow).toBeNull();
    expect(migrated.purchasedMaterials).toEqual([]);
    expect(migrated.paintColors).toEqual([]);
    expect(migrated.realYoutubeVideos).toEqual([]);
    expect(migrated.amazonProducts).toEqual([]);
    expect(migrated.redditThreads).toEqual([]);
    expect(migrated.pubchemSafety).toEqual([]);
    expect(migrated.propertyValueImpact).toBeNull();
    expect(migrated.scheduledReminderIds).toEqual([]);
  });

  it('preserves existing v2 fields during migration', () => {
    const old = { id: '1', weatherWindow: 'tomorrow', purchasedMaterials: ['nails'] };
    const migrated = migrateProject(old);
    expect(migrated.weatherWindow).toBe('tomorrow');
    expect(migrated.purchasedMaterials).toEqual(['nails']);
  });
});

// ── Honey-Do List ───────────────────────────────────────────────
describe('Honey-Do List', () => {
  it('returns empty array when nothing stored', async () => {
    const list = await getHoneyDoList();
    expect(list).toEqual([]);
  });

  it('saves and retrieves a project', async () => {
    const result = await saveToHoneyDoList({ title: 'Fix sink' });
    expect(result).toBe(true);
    const list = await getHoneyDoList();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Fix sink');
    expect(list[0].id).toBeDefined();
    expect(list[0].createdAt).toBeDefined();
    expect(list[0].schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  });

  it('prepends new projects', async () => {
    await saveToHoneyDoList({ title: 'First' });
    await saveToHoneyDoList({ title: 'Second' });
    const list = await getHoneyDoList();
    expect(list).toHaveLength(2);
    expect(list[0].title).toBe('Second');
    expect(list[1].title).toBe('First');
  });

  it('updates an existing project', async () => {
    await saveToHoneyDoList({ title: 'Original' });
    const list = await getHoneyDoList();
    const updated = { ...list[0], title: 'Updated' };
    const result = await updateHoneyDoList(updated);
    expect(result).toBe(true);
    const newList = await getHoneyDoList();
    expect(newList[0].title).toBe('Updated');
    expect(newList[0].lastActivityAt).toBeDefined();
  });

  it('removes a project by id', async () => {
    await saveToHoneyDoList({ title: 'ToRemove' });
    const list = await getHoneyDoList();
    const result = await removeFromHoneyDoList(list[0].id);
    expect(result).toBe(true);
    const newList = await getHoneyDoList();
    expect(newList).toHaveLength(0);
  });

  it('filters out invalid items', async () => {
    await AsyncStorage.setItem('@honey_do_list', JSON.stringify([null, {}, { id: '1', title: 'Valid' }]));
    const list = await getHoneyDoList();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Valid');
  });

  it('returns empty array on parse error', async () => {
    await AsyncStorage.setItem('@honey_do_list', 'not-json');
    AsyncStorage.getItem.mockRejectedValueOnce(new Error('parse'));
    const list = await getHoneyDoList();
    expect(list).toEqual([]);
  });
});

// ── Contractor List ─────────────────────────────────────────────
describe('Contractor List', () => {
  it('saves with quoteStatus default', async () => {
    await saveToContractorList({ title: 'Roof repair' });
    const list = await getContractorList();
    expect(list).toHaveLength(1);
    expect(list[0].quoteStatus).toBe('sent');
  });

  it('CRUD operations work', async () => {
    await saveToContractorList({ title: 'Plumbing' });
    let list = await getContractorList();
    expect(list).toHaveLength(1);

    await updateContractorList({ ...list[0], title: 'Updated Plumbing' });
    list = await getContractorList();
    expect(list[0].title).toBe('Updated Plumbing');

    await removeFromContractorList(list[0].id);
    list = await getContractorList();
    expect(list).toHaveLength(0);
  });
});

// ── User Profile ────────────────────────────────────────────────
describe('User Profile', () => {
  it('returns null when no profile saved', async () => {
    expect(await getUserProfile()).toBeNull();
  });

  it('saves and retrieves profile', async () => {
    await saveUserProfile({ name: 'John', email: 'john@test.com' });
    const profile = await getUserProfile();
    expect(profile.name).toBe('John');
    expect(profile.email).toBe('john@test.com');
  });
});

// ── Tool Inventory ──────────────────────────────────────────────
describe('Tool Inventory', () => {
  it('returns empty array by default', async () => {
    expect(await getToolInventory()).toEqual([]);
  });

  it('adds and removes tools', async () => {
    await addToInventory({ name: 'Hammer' });
    await addToInventory({ name: 'Wrench', barcode: '123456' });
    let tools = await getToolInventory();
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('Wrench'); // prepended
    expect(tools[0].barcode).toBe('123456');
    expect(tools[1].name).toBe('Hammer');
    expect(tools[1].barcode).toBeNull();

    await removeFromInventory(tools[0].id);
    tools = await getToolInventory();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('Hammer');
  });
});

// ── Shopping Bought State ───────────────────────────────────────
describe('Shopping Bought', () => {
  it('returns empty object by default', async () => {
    expect(await getShoppingBought()).toEqual({});
  });

  it('sets and retrieves bought state', async () => {
    await setShoppingBought('nails', true);
    await setShoppingBought('screws', false);
    const bought = await getShoppingBought();
    expect(bought.nails).toBe(true);
    expect(bought.screws).toBe(false);
  });
});

// ── App Preferences ─────────────────────────────────────────────
describe('App Preferences', () => {
  it('returns defaults when nothing stored', async () => {
    const prefs = await getAppPrefs();
    expect(prefs.darkMode).toBe(false);
    expect(prefs.skillLevel).toBe('intermediate');
    expect(prefs.zip).toBe('');
    expect(prefs.remindersEnabled).toBe(true);
    expect(prefs.reminderDays).toBe(3);
  });

  it('patches and merges preferences', async () => {
    const result = await setAppPrefs({ darkMode: true, zip: '90210' });
    expect(result.darkMode).toBe(true);
    expect(result.zip).toBe('90210');
    expect(result.skillLevel).toBe('intermediate'); // kept default

    const result2 = await setAppPrefs({ skillLevel: 'advanced' });
    expect(result2.darkMode).toBe(true); // kept previous
    expect(result2.skillLevel).toBe('advanced');
  });
});

// ── Offline Analysis Cache ──────────────────────────────────────
describe('Analysis Cache', () => {
  it('returns null for cache miss', async () => {
    expect(await getCachedAnalysis('test', 0)).toBeNull();
  });

  it('caches and retrieves analysis results', async () => {
    const result = { title: 'Fix Faucet', steps: ['1', '2'] };
    await setCachedAnalysis('leaky faucet', 1, result);
    const cached = await getCachedAnalysis('leaky faucet', 1);
    expect(cached.result).toEqual(result);
    expect(cached.cachedAt).toBeDefined();
  });

  it('is case-insensitive and trims descriptions', async () => {
    await setCachedAnalysis('  LEAKY FAUCET  ', 1, { title: 'Test' });
    const cached = await getCachedAnalysis('leaky faucet', 1);
    expect(cached).not.toBeNull();
  });

  it('evicts old entries when exceeding 30', async () => {
    for (let i = 0; i < 35; i++) {
      await setCachedAnalysis(`desc ${i}`, i, { title: `Result ${i}` });
    }
    // The cache should have at most 30 entries
    const raw = JSON.parse(AsyncStorage._store['@analyze_cache']);
    expect(Object.keys(raw).length).toBeLessThanOrEqual(30);
  });
});

// ── Local Help Requests ─────────────────────────────────────────
describe('Local Help Requests', () => {
  it('returns empty array by default', async () => {
    expect(await getLocalHelpRequests()).toEqual([]);
  });

  it('saves and retrieves help requests', async () => {
    const entry = await saveLocalHelpRequest({ title: 'Need plumber' });
    expect(entry.id).toBeDefined();
    expect(entry.status).toBe('sent');
    const list = await getLocalHelpRequests();
    expect(list).toHaveLength(1);
  });

  it('updates help request by id', async () => {
    const entry = await saveLocalHelpRequest({ title: 'Request' });
    await updateLocalHelpRequest(entry.id, { status: 'accepted' });
    const list = await getLocalHelpRequests();
    expect(list[0].status).toBe('accepted');
  });

  it('replaces existing entry with same id', async () => {
    const entry = await saveLocalHelpRequest({ id: 'fixed-id', title: 'First' });
    await saveLocalHelpRequest({ id: 'fixed-id', title: 'Replaced' });
    const list = await getLocalHelpRequests();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Replaced');
  });
});

// ── Most Recent Project ─────────────────────────────────────────
describe('getMostRecentProject', () => {
  it('returns null when no projects exist', async () => {
    expect(await getMostRecentProject()).toBeNull();
  });

  it('returns the most recently active project', async () => {
    await saveToHoneyDoList({ title: 'Old', steps: [] });
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));
    await saveToHoneyDoList({ title: 'New', steps: [] });
    const recent = await getMostRecentProject();
    expect(recent.title).toBe('New');
  });

  it('excludes fully completed projects', async () => {
    await saveToHoneyDoList({ title: 'Done', steps: ['a', 'b'], checkedSteps: [true, true] });
    await saveToHoneyDoList({ title: 'Active', steps: ['a', 'b'], checkedSteps: [true, false] });
    const recent = await getMostRecentProject();
    expect(recent.title).toBe('Active');
  });
});

// ── Community Opt-In ────────────────────────────────────────────
describe('Community Opt-In', () => {
  it('defaults to false', async () => {
    expect(await getCommunityOptIn()).toBe(false);
  });

  it('sets and retrieves opt-in value', async () => {
    await setCommunityOptIn(true);
    expect(await getCommunityOptIn()).toBe(true);
    await setCommunityOptIn(false);
    expect(await getCommunityOptIn()).toBe(false);
  });
});
