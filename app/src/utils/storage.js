import AsyncStorage from '@react-native-async-storage/async-storage';

const HONEY_DO_KEY = '@honey_do_list';
const CONTRACTOR_KEY = '@contractor_list';
const USER_PROFILE_KEY = '@user_profile';
const TOOL_INVENTORY_KEY = '@tool_inventory';
const SHOPPING_BOUGHT_KEY = '@shopping_bought';
const APP_PREFS_KEY = '@app_prefs';
const ANALYZE_CACHE_KEY = '@analyze_cache';
const HELP_REQUESTS_KEY = '@help_requests_local';
const COMMUNITY_OPT_IN_KEY = '@community_opt_in';
const ONBOARDING_SEEN_KEY = '@onboarding_seen';

export const getOnboardingSeen = async () => {
  try {
    const v = await AsyncStorage.getItem(ONBOARDING_SEEN_KEY);
    return v === 'true';
  } catch { return false; }
};

export const setOnboardingSeen = async () => {
  try { await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, 'true'); } catch {}
};

const generateId = () => Date.now().toString() + Math.floor(Math.random() * 1000);

// ── Schema version ─────────────────────────────────────────────────
// Bumped when the project shape gains new optional fields. Old records are
// upgraded lazily as they're read; no destructive rewrites.
export const PROJECT_SCHEMA_VERSION = 2;

export const migrateProject = (project) => {
  if (!project || typeof project !== 'object') return project;
  if (project.schemaVersion === PROJECT_SCHEMA_VERSION) return project;
  return {
    ...project,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    weatherWindow: project.weatherWindow || null,
    purchasedMaterials: project.purchasedMaterials || [],
    paintColors: project.paintColors || [],
    realYoutubeVideos: project.realYoutubeVideos || [],
    amazonProducts: project.amazonProducts || [],
    redditThreads: project.redditThreads || [],
    pubchemSafety: project.pubchemSafety || [],
    propertyValueImpact: project.propertyValueImpact || null,
    scheduledReminderIds: project.scheduledReminderIds || [],
  };
};

// ── Honey-Do List ───────────────────────────────────────────────────
export const saveToHoneyDoList = async (project) => {
  try {
    const existing = await getHoneyDoList();
    const newProject = migrateProject({
      ...project,
      id: generateId(),
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      photos: project.photos || [],
      stepNotes: project.stepNotes || {},
    });
    const updated = [newProject, ...existing];
    await AsyncStorage.setItem(HONEY_DO_KEY, JSON.stringify(updated));
    return true;
  } catch (e) {
    console.error('Failed to save to honey do list', e);
    return false;
  }
};

export const getHoneyDoList = async () => {
  try {
    const value = await AsyncStorage.getItem(HONEY_DO_KEY);
    const list = value != null ? JSON.parse(value) : [];
    return Array.isArray(list)
      ? list.filter(item => item && (item.id || item.title)).map(migrateProject)
      : [];
  } catch (e) {
    console.error('Failed to fetch honey do list', e);
    return [];
  }
};

export const updateHoneyDoList = async (updatedProject) => {
  try {
    const existing = await getHoneyDoList();
    const stamped = { ...updatedProject, lastActivityAt: new Date().toISOString() };
    const updated = existing.map(p => p.id === updatedProject.id ? stamped : p);
    await AsyncStorage.setItem(HONEY_DO_KEY, JSON.stringify(updated));
    return true;
  } catch (e) {
    console.error('Failed to update honey do list', e);
    return false;
  }
};

export const removeFromHoneyDoList = async (id) => {
  try {
    const existing = await getHoneyDoList();
    const updated = existing.filter(p => p.id !== id);
    await AsyncStorage.setItem(HONEY_DO_KEY, JSON.stringify(updated));
    return true;
  } catch (e) {
    console.error('Failed to remove from honey do list', e);
    return false;
  }
};

// ── Contractor List ─────────────────────────────────────────────────
export const saveToContractorList = async (project) => {
  try {
    const existing = await getContractorList();
    const newProject = migrateProject({
      ...project,
      id: generateId(),
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      photos: project.photos || [],
      quoteStatus: project.quoteStatus || 'sent',
    });
    const updated = [newProject, ...existing];
    await AsyncStorage.setItem(CONTRACTOR_KEY, JSON.stringify(updated));
    return true;
  } catch (e) {
    console.error('Failed to save to contractor list', e);
    return false;
  }
};

export const getContractorList = async () => {
  try {
    const value = await AsyncStorage.getItem(CONTRACTOR_KEY);
    const list = value != null ? JSON.parse(value) : [];
    return Array.isArray(list)
      ? list.filter(item => item && (item.id || item.title)).map(migrateProject)
      : [];
  } catch (e) {
    console.error('Failed to fetch contractor list', e);
    return [];
  }
};

export const updateContractorList = async (updatedProject) => {
  try {
    const existing = await getContractorList();
    const stamped = { ...updatedProject, lastActivityAt: new Date().toISOString() };
    const updated = existing.map(p => p.id === updatedProject.id ? stamped : p);
    await AsyncStorage.setItem(CONTRACTOR_KEY, JSON.stringify(updated));
    return true;
  } catch (e) {
    console.error('Failed to update contractor list', e);
    return false;
  }
};

export const removeFromContractorList = async (id) => {
  try {
    const existing = await getContractorList();
    const updated = existing.filter(p => p.id !== id);
    await AsyncStorage.setItem(CONTRACTOR_KEY, JSON.stringify(updated));
    return true;
  } catch (e) {
    console.error('Failed to remove from contractor list', e);
    return false;
  }
};

// ── User profile ────────────────────────────────────────────────────
export const saveUserProfile = async (profile) => {
  try {
    await AsyncStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile));
    return true;
  } catch (e) {
    console.error('Failed to save user profile', e);
    return false;
  }
};

export const getUserProfile = async () => {
  try {
    const value = await AsyncStorage.getItem(USER_PROFILE_KEY);
    return value != null ? JSON.parse(value) : null;
  } catch (e) {
    console.error('Failed to fetch user profile', e);
    return null;
  }
};

// ── Tool inventory (#5, #8) ─────────────────────────────────────────
export const getToolInventory = async () => {
  try {
    const value = await AsyncStorage.getItem(TOOL_INVENTORY_KEY);
    return value != null ? JSON.parse(value) : [];
  } catch (e) {
    return [];
  }
};

export const addToInventory = async (item) => {
  const list = await getToolInventory();
  const entry = { id: generateId(), name: item.name, addedAt: new Date().toISOString(), barcode: item.barcode || null };
  const updated = [entry, ...list];
  await AsyncStorage.setItem(TOOL_INVENTORY_KEY, JSON.stringify(updated));
  return true;
};

export const removeFromInventory = async (id) => {
  const list = await getToolInventory();
  const updated = list.filter(i => i.id !== id);
  await AsyncStorage.setItem(TOOL_INVENTORY_KEY, JSON.stringify(updated));
  return true;
};

export const findInventoryByBarcode = async (barcode) => {
  if (!barcode) return null;
  const list = await getToolInventory();
  return list.find(i => i.barcode && i.barcode === barcode) || null;
};

// ── Shopping bought-state map (#6) ──────────────────────────────────
export const getShoppingBought = async () => {
  try {
    const value = await AsyncStorage.getItem(SHOPPING_BOUGHT_KEY);
    return value != null ? JSON.parse(value) : {};
  } catch (e) {
    return {};
  }
};

export const setShoppingBought = async (key, bought) => {
  const map = await getShoppingBought();
  map[key] = bought;
  await AsyncStorage.setItem(SHOPPING_BOUGHT_KEY, JSON.stringify(map));
  return true;
};

// ── App preferences (#24 dark mode, #15 skill, #14 zip, etc) ────────
export const getAppPrefs = async () => {
  try {
    const value = await AsyncStorage.getItem(APP_PREFS_KEY);
    const parsed = value != null ? JSON.parse(value) : {};
    return {
      darkMode: false,
      skillLevel: 'intermediate',
      zip: '',
      remindersEnabled: true,
      reminderDays: 3,
      ...parsed,
    };
  } catch (e) {
    return { darkMode: false, skillLevel: 'intermediate', zip: '', remindersEnabled: true, reminderDays: 3 };
  }
};

export const setAppPrefs = async (patch) => {
  const current = await getAppPrefs();
  const next = { ...current, ...patch };
  await AsyncStorage.setItem(APP_PREFS_KEY, JSON.stringify(next));
  return next;
};

// ── Offline analyze cache (#23) ─────────────────────────────────────
const cacheKeyFor = (description, mediaCount) => {
  // simple hash: trimmed description + media count
  const desc = (description || '').trim().toLowerCase().slice(0, 200);
  return `${desc}::${mediaCount}`;
};

export const getCachedAnalysis = async (description, mediaCount) => {
  try {
    const value = await AsyncStorage.getItem(ANALYZE_CACHE_KEY);
    const cache = value != null ? JSON.parse(value) : {};
    return cache[cacheKeyFor(description, mediaCount)] || null;
  } catch (e) {
    return null;
  }
};

export const setCachedAnalysis = async (description, mediaCount, result) => {
  try {
    const value = await AsyncStorage.getItem(ANALYZE_CACHE_KEY);
    const cache = value != null ? JSON.parse(value) : {};
    cache[cacheKeyFor(description, mediaCount)] = { result, cachedAt: new Date().toISOString() };
    // Keep cache from growing forever — limit to 30 entries
    const keys = Object.keys(cache);
    if (keys.length > 30) {
      const sorted = keys.sort((a, b) => new Date(cache[a].cachedAt) - new Date(cache[b].cachedAt));
      sorted.slice(0, keys.length - 30).forEach(k => delete cache[k]);
    }
    await AsyncStorage.setItem(ANALYZE_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.error('Failed to cache analysis', e);
  }
};

// ── Local mirror of help requests (#20, #21) ────────────────────────
export const getLocalHelpRequests = async () => {
  try {
    const value = await AsyncStorage.getItem(HELP_REQUESTS_KEY);
    return value != null ? JSON.parse(value) : [];
  } catch (e) {
    return [];
  }
};

export const saveLocalHelpRequest = async (record) => {
  const list = await getLocalHelpRequests();
  const entry = { id: record.id || generateId(), status: 'sent', createdAt: new Date().toISOString(), ...record };
  const updated = [entry, ...list.filter(r => r.id !== entry.id)];
  await AsyncStorage.setItem(HELP_REQUESTS_KEY, JSON.stringify(updated));
  return entry;
};

export const updateLocalHelpRequest = async (id, patch) => {
  const list = await getLocalHelpRequests();
  const updated = list.map(r => r.id === id ? { ...r, ...patch } : r);
  await AsyncStorage.setItem(HELP_REQUESTS_KEY, JSON.stringify(updated));
};

// ── Most recently active project across both lists (#3) ────────────
export const getMostRecentProject = async () => {
  const honey = await getHoneyDoList();
  const contractor = await getContractorList();
  const all = [
    ...honey.map(p => ({ ...p, _list: 'honey-do' })),
    ...contractor.map(p => ({ ...p, _list: 'contractor' })),
  ];
  // Filter out fully completed
  const active = all.filter(p => {
    const steps = Array.isArray(p.steps) ? p.steps : [];
    const checked = Array.isArray(p.checkedSteps) ? p.checkedSteps : [];
    if (steps.length === 0) return true;
    return !steps.every((_, i) => checked[i]);
  });
  active.sort((a, b) => {
    const da = new Date(a.lastActivityAt || a.createdAt || 0).getTime();
    const db = new Date(b.lastActivityAt || b.createdAt || 0).getTime();
    return db - da;
  });
  return active[0] || null;
};

// ── Community opt-in (#18) ──────────────────────────────────────────
export const getCommunityOptIn = async () => {
  try {
    const value = await AsyncStorage.getItem(COMMUNITY_OPT_IN_KEY);
    return value === 'true';
  } catch (e) {
    return false;
  }
};

export const setCommunityOptIn = async (val) => {
  await AsyncStorage.setItem(COMMUNITY_OPT_IN_KEY, val ? 'true' : 'false');
};

// ── Clear all user data (account deletion) ─────────────────────────
export const clearAllUserData = async () => {
  const allKeys = [
    HONEY_DO_KEY,
    CONTRACTOR_KEY,
    USER_PROFILE_KEY,
    TOOL_INVENTORY_KEY,
    SHOPPING_BOUGHT_KEY,
    APP_PREFS_KEY,
    ANALYZE_CACHE_KEY,
    HELP_REQUESTS_KEY,
    COMMUNITY_OPT_IN_KEY,
  ];
  await AsyncStorage.multiRemove(allKeys);
};
