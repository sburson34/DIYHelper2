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

// ── Types ──────────────────────────────────────────────────────────

export interface ShoppingLink {
  item: string;
  url?: string;
  amazon_url?: string;
  homedepot_url?: string;
}

export interface Project {
  id: string;
  title?: string;
  schemaVersion: number;
  steps?: string[];
  tools_and_materials?: string[];
  difficulty?: string;
  estimated_time?: string;
  estimated_cost?: string;
  youtube_links?: unknown[];
  shopping_links?: (string | ShoppingLink)[];
  safety_tips?: string[];
  when_to_call_pro?: string[];
  createdAt?: string;
  lastActivityAt?: string;
  photos?: unknown[];
  stepNotes?: Record<string, string>;
  checkedSteps?: boolean[];
  weatherWindow?: unknown;
  purchasedMaterials?: unknown[];
  paintColors?: unknown[];
  realYoutubeVideos?: unknown[];
  amazonProducts?: unknown[];
  redditThreads?: unknown[];
  pubchemSafety?: unknown[];
  propertyValueImpact?: unknown;
  scheduledReminderIds?: string[];
  quoteStatus?: string;
  repair_type?: string;
  [extra: string]: unknown;
}

export interface ToolItem {
  id: string;
  name: string;
  addedAt: string;
  barcode: string | null;
}

export interface UserProfile {
  name?: string;
  email?: string;
  phone?: string;
  [extra: string]: unknown;
}

export type SkillLevel = 'beginner' | 'intermediate' | 'advanced';

export interface AppPrefs {
  darkMode: boolean;
  skillLevel: SkillLevel;
  zip: string;
  remindersEnabled: boolean;
  reminderDays: number;
  [extra: string]: unknown;
}

export interface HelpRequest {
  id: string;
  status: string;
  createdAt: string;
  projectTitle?: string;
  userDescription?: string;
  [extra: string]: unknown;
}

export interface CachedAnalysisEntry {
  result: unknown;
  cachedAt: string;
}

// ── Onboarding ─────────────────────────────────────────────────────

export const getOnboardingSeen = async (): Promise<boolean> => {
  try {
    const v = await AsyncStorage.getItem(ONBOARDING_SEEN_KEY);
    return v === 'true';
  } catch { return false; }
};

export const setOnboardingSeen = async (): Promise<void> => {
  try { await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, 'true'); } catch {}
};

const generateId = (): string => Date.now().toString() + Math.floor(Math.random() * 1000);

// ── Schema version ─────────────────────────────────────────────────
// Bumped when the project shape gains new optional fields. Old records are
// upgraded lazily as they're read; no destructive rewrites.
export const PROJECT_SCHEMA_VERSION = 2;

// Accepts unknown input to match existing JS callers and tests that pass
// null/undefined/strings through. Returns the input unchanged when it's not
// an object; otherwise returns a migrated Project.
export const migrateProject = (project: unknown): unknown => {
  if (!project || typeof project !== 'object') return project;
  const p = project as Partial<Project>;
  if (p.schemaVersion === PROJECT_SCHEMA_VERSION) return project;
  return {
    ...p,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    weatherWindow: p.weatherWindow || null,
    purchasedMaterials: p.purchasedMaterials || [],
    paintColors: p.paintColors || [],
    realYoutubeVideos: p.realYoutubeVideos || [],
    amazonProducts: p.amazonProducts || [],
    redditThreads: p.redditThreads || [],
    pubchemSafety: p.pubchemSafety || [],
    propertyValueImpact: p.propertyValueImpact || null,
    scheduledReminderIds: p.scheduledReminderIds || [],
  };
};

// ── Honey-Do List ───────────────────────────────────────────────────
export const saveToHoneyDoList = async (project: Partial<Project>): Promise<boolean> => {
  try {
    const existing = await getHoneyDoList();
    const newProject = migrateProject({
      ...project,
      id: generateId(),
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      photos: project.photos || [],
      stepNotes: project.stepNotes || {},
    }) as Project;
    const updated = [newProject, ...existing];
    await AsyncStorage.setItem(HONEY_DO_KEY, JSON.stringify(updated));
    return true;
  } catch (e) {
    console.error('Failed to save to honey do list', e);
    return false;
  }
};

export const getHoneyDoList = async (): Promise<Project[]> => {
  try {
    const value = await AsyncStorage.getItem(HONEY_DO_KEY);
    const list = value != null ? JSON.parse(value) : [];
    return Array.isArray(list)
      ? (list
          .filter((item: Partial<Project> | null) => item && (item.id || item.title))
          .map(migrateProject) as Project[])
      : [];
  } catch (e) {
    console.error('Failed to fetch honey do list', e);
    return [];
  }
};

export const updateHoneyDoList = async (updatedProject: Project): Promise<boolean> => {
  try {
    const existing = await getHoneyDoList();
    const stamped: Project = { ...updatedProject, lastActivityAt: new Date().toISOString() };
    const updated = existing.map(p => p.id === updatedProject.id ? stamped : p);
    await AsyncStorage.setItem(HONEY_DO_KEY, JSON.stringify(updated));
    return true;
  } catch (e) {
    console.error('Failed to update honey do list', e);
    return false;
  }
};

export const removeFromHoneyDoList = async (id: string): Promise<boolean> => {
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
export const saveToContractorList = async (project: Partial<Project>): Promise<boolean> => {
  try {
    const existing = await getContractorList();
    const newProject = migrateProject({
      ...project,
      id: generateId(),
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      photos: project.photos || [],
      quoteStatus: project.quoteStatus || 'sent',
    }) as Project;
    const updated = [newProject, ...existing];
    await AsyncStorage.setItem(CONTRACTOR_KEY, JSON.stringify(updated));
    return true;
  } catch (e) {
    console.error('Failed to save to contractor list', e);
    return false;
  }
};

export const getContractorList = async (): Promise<Project[]> => {
  try {
    const value = await AsyncStorage.getItem(CONTRACTOR_KEY);
    const list = value != null ? JSON.parse(value) : [];
    return Array.isArray(list)
      ? (list
          .filter((item: Partial<Project> | null) => item && (item.id || item.title))
          .map(migrateProject) as Project[])
      : [];
  } catch (e) {
    console.error('Failed to fetch contractor list', e);
    return [];
  }
};

export const updateContractorList = async (updatedProject: Project): Promise<boolean> => {
  try {
    const existing = await getContractorList();
    const stamped: Project = { ...updatedProject, lastActivityAt: new Date().toISOString() };
    const updated = existing.map(p => p.id === updatedProject.id ? stamped : p);
    await AsyncStorage.setItem(CONTRACTOR_KEY, JSON.stringify(updated));
    return true;
  } catch (e) {
    console.error('Failed to update contractor list', e);
    return false;
  }
};

export const removeFromContractorList = async (id: string): Promise<boolean> => {
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
export const saveUserProfile = async (profile: UserProfile): Promise<boolean> => {
  try {
    await AsyncStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile));
    return true;
  } catch (e) {
    console.error('Failed to save user profile', e);
    return false;
  }
};

export const getUserProfile = async (): Promise<UserProfile | null> => {
  try {
    const value = await AsyncStorage.getItem(USER_PROFILE_KEY);
    return value != null ? (JSON.parse(value) as UserProfile) : null;
  } catch (e) {
    console.error('Failed to fetch user profile', e);
    return null;
  }
};

// ── Tool inventory (#5, #8) ─────────────────────────────────────────
export const getToolInventory = async (): Promise<ToolItem[]> => {
  try {
    const value = await AsyncStorage.getItem(TOOL_INVENTORY_KEY);
    return value != null ? (JSON.parse(value) as ToolItem[]) : [];
  } catch {
    return [];
  }
};

export const addToInventory = async (
  item: { name: string; barcode?: string | null },
): Promise<boolean> => {
  const list = await getToolInventory();
  const entry: ToolItem = {
    id: generateId(),
    name: item.name,
    addedAt: new Date().toISOString(),
    barcode: item.barcode || null,
  };
  const updated = [entry, ...list];
  await AsyncStorage.setItem(TOOL_INVENTORY_KEY, JSON.stringify(updated));
  return true;
};

export const removeFromInventory = async (id: string): Promise<boolean> => {
  const list = await getToolInventory();
  const updated = list.filter(i => i.id !== id);
  await AsyncStorage.setItem(TOOL_INVENTORY_KEY, JSON.stringify(updated));
  return true;
};

export const findInventoryByBarcode = async (barcode: string | null | undefined): Promise<ToolItem | null> => {
  if (!barcode) return null;
  const list = await getToolInventory();
  return list.find(i => i.barcode && i.barcode === barcode) || null;
};

// ── Shopping bought-state map (#6) ──────────────────────────────────
export const getShoppingBought = async (): Promise<Record<string, boolean>> => {
  try {
    const value = await AsyncStorage.getItem(SHOPPING_BOUGHT_KEY);
    return value != null ? (JSON.parse(value) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
};

export const setShoppingBought = async (key: string, bought: boolean): Promise<boolean> => {
  const map = await getShoppingBought();
  map[key] = bought;
  await AsyncStorage.setItem(SHOPPING_BOUGHT_KEY, JSON.stringify(map));
  return true;
};

// ── App preferences (#24 dark mode, #15 skill, #14 zip, etc) ────────
const DEFAULT_PREFS: AppPrefs = {
  darkMode: false,
  skillLevel: 'intermediate',
  zip: '',
  remindersEnabled: true,
  reminderDays: 3,
};

export const getAppPrefs = async (): Promise<AppPrefs> => {
  try {
    const value = await AsyncStorage.getItem(APP_PREFS_KEY);
    const parsed = value != null ? (JSON.parse(value) as Partial<AppPrefs>) : {};
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_PREFS };
  }
};

export const setAppPrefs = async (patch: Partial<AppPrefs>): Promise<AppPrefs> => {
  const current = await getAppPrefs();
  const next: AppPrefs = { ...current, ...patch };
  await AsyncStorage.setItem(APP_PREFS_KEY, JSON.stringify(next));
  return next;
};

// ── Offline analyze cache (#23) ─────────────────────────────────────
const cacheKeyFor = (description: string | null | undefined, mediaCount: number): string => {
  // simple hash: trimmed description + media count
  const desc = (description || '').trim().toLowerCase().slice(0, 200);
  return `${desc}::${mediaCount}`;
};

export const getCachedAnalysis = async (
  description: string | null | undefined,
  mediaCount: number,
): Promise<CachedAnalysisEntry | null> => {
  try {
    const value = await AsyncStorage.getItem(ANALYZE_CACHE_KEY);
    const cache = value != null ? (JSON.parse(value) as Record<string, CachedAnalysisEntry>) : {};
    return cache[cacheKeyFor(description, mediaCount)] || null;
  } catch {
    return null;
  }
};

export const setCachedAnalysis = async (
  description: string | null | undefined,
  mediaCount: number,
  result: unknown,
): Promise<void> => {
  try {
    const value = await AsyncStorage.getItem(ANALYZE_CACHE_KEY);
    const cache: Record<string, CachedAnalysisEntry> =
      value != null ? (JSON.parse(value) as Record<string, CachedAnalysisEntry>) : {};
    cache[cacheKeyFor(description, mediaCount)] = { result, cachedAt: new Date().toISOString() };
    // Keep cache from growing forever — limit to 30 entries
    const keys = Object.keys(cache);
    if (keys.length > 30) {
      const sorted = keys.sort(
        (a, b) => new Date(cache[a].cachedAt).getTime() - new Date(cache[b].cachedAt).getTime(),
      );
      sorted.slice(0, keys.length - 30).forEach(k => delete cache[k]);
    }
    await AsyncStorage.setItem(ANALYZE_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.error('Failed to cache analysis', e);
  }
};

// ── Local mirror of help requests (#20, #21) ────────────────────────
export const getLocalHelpRequests = async (): Promise<HelpRequest[]> => {
  try {
    const value = await AsyncStorage.getItem(HELP_REQUESTS_KEY);
    return value != null ? (JSON.parse(value) as HelpRequest[]) : [];
  } catch {
    return [];
  }
};

export const saveLocalHelpRequest = async (
  record: Partial<HelpRequest> & { id?: string },
): Promise<HelpRequest> => {
  const list = await getLocalHelpRequests();
  const entry: HelpRequest = {
    status: 'sent',
    createdAt: new Date().toISOString(),
    ...record,
    id: record.id || generateId(),
  };
  const updated = [entry, ...list.filter(r => r.id !== entry.id)];
  await AsyncStorage.setItem(HELP_REQUESTS_KEY, JSON.stringify(updated));
  return entry;
};

export const updateLocalHelpRequest = async (
  id: string,
  patch: Partial<HelpRequest>,
): Promise<void> => {
  const list = await getLocalHelpRequests();
  const updated = list.map(r => r.id === id ? { ...r, ...patch } : r);
  await AsyncStorage.setItem(HELP_REQUESTS_KEY, JSON.stringify(updated));
};

// ── Most recently active project across both lists (#3) ────────────
export interface RecentProject extends Project {
  _list: 'honey-do' | 'contractor';
}

export const getMostRecentProject = async (): Promise<RecentProject | null> => {
  const honey = await getHoneyDoList();
  const contractor = await getContractorList();
  const all: RecentProject[] = [
    ...honey.map(p => ({ ...p, _list: 'honey-do' as const })),
    ...contractor.map(p => ({ ...p, _list: 'contractor' as const })),
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
export const getCommunityOptIn = async (): Promise<boolean> => {
  try {
    const value = await AsyncStorage.getItem(COMMUNITY_OPT_IN_KEY);
    return value === 'true';
  } catch {
    return false;
  }
};

export const setCommunityOptIn = async (val: boolean): Promise<void> => {
  await AsyncStorage.setItem(COMMUNITY_OPT_IN_KEY, val ? 'true' : 'false');
};

// ── Clear all user data (account deletion) ─────────────────────────
export const clearAllUserData = async (): Promise<void> => {
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
