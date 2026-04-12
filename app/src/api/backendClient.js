import { API_BASE_URL } from '../config/api';
import { getCachedAnalysis, setCachedAnalysis, getAppPrefs, getToolInventory } from '../utils/storage';

const BASE_URL = API_BASE_URL;

const jsonFetch = async (url, body, opts = {}) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...opts,
  });
  if (!response.ok) {
    let errorData = {};
    try { errorData = await response.json(); } catch {}
    throw new Error(errorData.error || `Request failed: ${response.status}`);
  }
  return response.json();
};

// ── #5/#14/#15: enriched analyze with prefs + inventory ────────────
const analyzeProject = async (description, mediaItems = [], language = 'en') => {
  const url = `${BASE_URL}/api/analyze`;
  const prefs = await getAppPrefs().catch(() => ({}));
  const inventory = await getToolInventory().catch(() => []);

  try {
    const result = await jsonFetch(url, {
      description,
      media: mediaItems,
      language,
      skillLevel: prefs.skillLevel,
      zip: prefs.zip,
      ownedTools: inventory.map(i => i.name),
    });
    // Cache successful analyses for offline mode (#23). Fire-and-forget so the
    // navigate-to-Result transition isn't blocked by AsyncStorage serialization
    // (which can take seconds when the cache file grows).
    setCachedAnalysis(description, mediaItems.length, result).catch(() => {});
    return result;
  } catch (error) {
    console.error('Error in analyzeProject detail:', error);
    // Offline fallback
    const cached = await getCachedAnalysis(description, mediaItems.length);
    if (cached) {
      console.log('Using cached analysis (offline mode)');
      return { ...cached.result, _fromCache: true, _cachedAt: cached.cachedAt };
    }
    if (error.message === 'Network request failed') {
      throw new Error(`Network error! Hit ${url} and it failed. Check adb reverse tcp:5206 tcp:5206 and that backend is running.`);
    }
    throw error;
  }
};

const askHelper = async (question, project, language = 'en') => {
  const url = `${BASE_URL}/api/ask-helper`;
  return jsonFetch(url, { question, projectContext: project, language });
};

// ── #9: verify a finished step ─────────────────────────────────────
const verifyStep = async ({ stepText, projectTitle, base64Image, mimeType, language = 'en' }) => {
  const url = `${BASE_URL}/api/verify-step`;
  return jsonFetch(url, { stepText, projectTitle, base64Image, mimeType, language });
};

// ── #10: diagnostic mode ───────────────────────────────────────────
const diagnoseProblem = async ({ description, media = [], language = 'en' }) => {
  const url = `${BASE_URL}/api/diagnose`;
  return jsonFetch(url, { description, media, language });
};

// ── #11: progressive clarifying questions ──────────────────────────
const getClarifyingQuestions = async ({ description, media = [], language = 'en' }) => {
  const url = `${BASE_URL}/api/clarify`;
  return jsonFetch(url, { description, media, language });
};

// ── #20/#21: help requests ─────────────────────────────────────────
const submitHelpRequest = async ({ customerName, customerEmail, customerPhone, projectTitle, userDescription, projectData, imageBase64 }) => {
  const url = `${BASE_URL}/api/help-requests`;
  return jsonFetch(url, {
    customerName,
    customerEmail,
    customerPhone,
    projectTitle,
    userDescription,
    projectData: typeof projectData === 'string' ? projectData : JSON.stringify(projectData || {}),
    imageBase64,
  });
};

const getHelpRequest = async (id) => {
  const response = await fetch(`${BASE_URL}/api/help-requests/${id}`);
  if (!response.ok) throw new Error('Failed to fetch help request');
  return response.json();
};

const updateHelpRequestStatus = async (id, status, notes) => {
  const response = await fetch(`${BASE_URL}/api/help-requests/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, notes }),
  });
  if (!response.ok) throw new Error('Failed to update help request');
  return response.json();
};

const listHelpRequests = async (status) => {
  const url = status
    ? `${BASE_URL}/api/help-requests?status=${encodeURIComponent(status)}`
    : `${BASE_URL}/api/help-requests`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to list help requests');
  return response.json();
};

// ── #18: community-shared projects ─────────────────────────────────
const submitCommunityProject = async (project) => {
  const url = `${BASE_URL}/api/community-projects`;
  return jsonFetch(url, project);
};

const browseCommunityProjects = async (query = '') => {
  const url = query
    ? `${BASE_URL}/api/community-projects?q=${encodeURIComponent(query)}`
    : `${BASE_URL}/api/community-projects`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to browse community projects');
  return response.json();
};

// ── External API integrations ─────────────────────────────────────

const getFeatures = async () => {
  try {
    const response = await fetch(`${BASE_URL}/api/features`);
    if (!response.ok) throw new Error(`features ${response.status}`);
    return response.json();
  } catch (e) {
    // Sane defaults if the backend is unreachable or hasn't deployed yet
    return { amazonPa: false, attom: false, paintColors: false, claudeFallback: false,
             youtube: false, weather: false, reddit: true, pubchem: true, receiptOcr: false };
  }
};

const getWeather = async (zip, days = 5) => {
  const url = `${BASE_URL}/api/weather?zip=${encodeURIComponent(zip)}&days=${days}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Weather request failed: ${response.status}`);
  return response.json();
};

const getRedditDiscussions = async (query) => {
  const url = `${BASE_URL}/api/reddit-discussions?query=${encodeURIComponent(query)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Reddit request failed: ${response.status}`);
  return response.json();
};

const getSafetyData = async (chemical) => {
  const url = `${BASE_URL}/api/safety-data?chemical=${encodeURIComponent(chemical)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Safety data request failed: ${response.status}`);
  return response.json();
};

const getPropertyValueImpact = async ({ zip, repairType, estimatedCost }) => {
  const params = new URLSearchParams();
  if (zip) params.append('zip', zip);
  params.append('repairType', repairType || 'general');
  params.append('estimatedCost', String(estimatedCost || 0));
  const url = `${BASE_URL}/api/property-value-impact?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Property value request failed: ${response.status}`);
  return response.json();
};

const uploadReceipt = async ({ base64Image, mimeType, projectId }) => {
  const url = `${BASE_URL}/api/receipt-ocr`;
  return jsonFetch(url, { base64Image, mimeType, projectId });
};

const matchPaintColor = async ({ base64Image, mimeType }) => {
  const url = `${BASE_URL}/api/paint-color-match`;
  return jsonFetch(url, { base64Image, mimeType });
};

export {
  analyzeProject,
  askHelper,
  verifyStep,
  diagnoseProblem,
  getClarifyingQuestions,
  submitHelpRequest,
  getHelpRequest,
  updateHelpRequestStatus,
  listHelpRequests,
  submitCommunityProject,
  browseCommunityProjects,
  getFeatures,
  getWeather,
  getRedditDiscussions,
  getSafetyData,
  getPropertyValueImpact,
  uploadReceipt,
  matchPaintColor,
};
