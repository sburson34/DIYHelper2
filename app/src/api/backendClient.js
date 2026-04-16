import { API_BASE_URL } from '../config/api';
import { getCachedAnalysis, setCachedAnalysis, getAppPrefs, getToolInventory } from '../utils/storage';
import { reportError, reportHandledError, addBreadcrumb } from '../services/monitoring';
import { RELEASE } from '../config/appInfo';

const BASE_URL = API_BASE_URL;

// ── Correlation ID ────────────────────────────────────────────────────
let counter = 0;
const generateCorrelationId = () => {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}-${rand}-${++counter}`;
};

// ── Instrumented fetch ────────────────────────────────────────────────
// Every outbound request gets a correlation ID, timing, and breadcrumbs.
const apiFetch = async (url, options = {}) => {
  const correlationId = generateCorrelationId();
  const method = options.method || 'GET';
  const path = url.replace(BASE_URL, '');

  const headers = {
    'Content-Type': 'application/json',
    'X-Correlation-ID': correlationId,
    'X-App-Version': RELEASE,
    ...options.headers,
  };

  addBreadcrumb(`${method} ${path}`, 'http', {
    url: path,
    method,
    correlationId,
  });

  const start = Date.now();
  let status;
  try {
    const response = await fetch(url, { ...options, headers });
    status = response.status;
    const durationMs = Date.now() - start;

    if (!response.ok) {
      let errorMessage;
      try {
        const body = await response.json();
        errorMessage = body.error || body.message;
      } catch {}

      const summary = errorMessage || `HTTP ${status}`;
      addBreadcrumb(`${method} ${path} failed: ${summary}`, 'http', {
        url: path, method, status, durationMs, correlationId,
      });
      const err = new Error(summary);
      err.status = status;
      err.correlationId = correlationId;
      err.durationMs = durationMs;
      throw err;
    }

    addBreadcrumb(`${method} ${path} OK`, 'http', {
      url: path, method, status, durationMs, correlationId,
    });
    return response;
  } catch (error) {
    const durationMs = Date.now() - start;
    // Network-level failure (no response at all)
    if (!status) {
      addBreadcrumb(`${method} ${path} network error`, 'http', {
        url: path, method, durationMs, correlationId,
        error: error.message,
      });
    }
    if (!error.correlationId) {
      error.correlationId = correlationId;
      error.durationMs = durationMs;
    }
    throw error;
  }
};

// Convenience: POST JSON body → parsed JSON response
const jsonPost = async (url, body) => {
  const response = await apiFetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return response.json();
};

// Convenience: GET → parsed JSON response
const jsonGet = async (url) => {
  const response = await apiFetch(url);
  return response.json();
};

// Convenience: PUT JSON body → parsed JSON response
const jsonPut = async (url, body) => {
  const response = await apiFetch(url, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return response.json();
};

// ── Endpoints ─────────────────────────────────────────────────────────

const analyzeProject = async (description, mediaItems = [], language = 'en') => {
  const url = `${BASE_URL}/api/analyze`;
  const prefs = await getAppPrefs().catch(() => ({}));
  const inventory = await getToolInventory().catch(() => []);

  addBreadcrumb('AI: analyze project', 'ai', {
    action: 'analyze',
    descriptionLength: description?.length ?? 0,
    mediaCount: mediaItems.length,
    language,
  });

  try {
    const result = await jsonPost(url, {
      description,
      media: mediaItems,
      language,
      skillLevel: prefs.skillLevel,
      zip: prefs.zip,
      ownedTools: inventory.map(i => i.name),
    });
    setCachedAnalysis(description, mediaItems.length, result).catch(() => {});
    return result;
  } catch (error) {
    console.error('Error in analyzeProject detail:', error);
    const cached = await getCachedAnalysis(description, mediaItems.length);
    if (cached) {
      reportHandledError('AnalysisFallbackToCache', error, {
        mediaCount: mediaItems.length,
        cacheAge: Date.now() - cached.cachedAt,
        correlationId: error.correlationId,
      });
      return { ...cached.result, _fromCache: true, _cachedAt: cached.cachedAt };
    }
    if (error.message === 'Network request failed') {
      reportError(error, {
        source: 'backendClient',
        operation: 'analyzeProject',
        extra: { url, mediaCount: mediaItems.length, correlationId: error.correlationId },
      });
      throw new Error(`Network error! Hit ${url} and it failed. Check adb reverse tcp:5206 tcp:5206 and that backend is running.`);
    }
    reportError(error, {
      source: 'backendClient',
      operation: 'analyzeProject',
      extra: { correlationId: error.correlationId },
    });
    throw error;
  }
};

const askHelper = async (question, project, language = 'en') => {
  addBreadcrumb('AI: ask helper', 'ai', {
    action: 'ask-helper',
    questionLength: question?.length ?? 0,
    language,
  });
  return jsonPost(`${BASE_URL}/api/ask-helper`, { question, projectContext: project, language });
};

const verifyStep = async ({ stepText, projectTitle, base64Image, mimeType, language = 'en' }) => {
  addBreadcrumb('AI: verify step', 'ai', {
    action: 'verify-step',
    hasImage: !!base64Image,
    language,
  });
  return jsonPost(`${BASE_URL}/api/verify-step`, { stepText, projectTitle, base64Image, mimeType, language });
};

const diagnoseProblem = async ({ description, media = [], language = 'en' }) => {
  addBreadcrumb('AI: diagnose', 'ai', {
    action: 'diagnose',
    descriptionLength: description?.length ?? 0,
    mediaCount: media.length,
    language,
  });
  return jsonPost(`${BASE_URL}/api/diagnose`, { description, media, language });
};

const getClarifyingQuestions = async ({ description, media = [], language = 'en' }) => {
  addBreadcrumb('AI: clarify', 'ai', {
    action: 'clarify',
    descriptionLength: description?.length ?? 0,
    mediaCount: media.length,
    language,
  });
  return jsonPost(`${BASE_URL}/api/clarify`, { description, media, language });
};

const submitHelpRequest = async ({ customerName, customerEmail, customerPhone, projectTitle, userDescription, projectData, imageBase64 }) => {
  return jsonPost(`${BASE_URL}/api/help-requests`, {
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
  return jsonGet(`${BASE_URL}/api/help-requests/${id}`);
};

const updateHelpRequestStatus = async (id, status, notes) => {
  return jsonPut(`${BASE_URL}/api/help-requests/${id}`, { status, notes });
};

const listHelpRequests = async (status) => {
  const url = status
    ? `${BASE_URL}/api/help-requests?status=${encodeURIComponent(status)}`
    : `${BASE_URL}/api/help-requests`;
  return jsonGet(url);
};

const submitCommunityProject = async (project) => {
  return jsonPost(`${BASE_URL}/api/community-projects`, project);
};

const browseCommunityProjects = async (query = '') => {
  const url = query
    ? `${BASE_URL}/api/community-projects?q=${encodeURIComponent(query)}`
    : `${BASE_URL}/api/community-projects`;
  return jsonGet(url);
};

// ── External API integrations ─────────────────────────────────────
// Each call goes through the instrumented apiFetch above so correlation IDs
// and breadcrumbs cover the new endpoints too. Failures return sane defaults
// where that keeps the UI from breaking on a partial outage.

const getFeatures = async () => {
  try {
    return await jsonGet(`${BASE_URL}/api/features`);
  } catch {
    return { amazonPa: false, attom: false, paintColors: false, claudeFallback: false,
             youtube: false, weather: false, reddit: true, pubchem: true, receiptOcr: false };
  }
};

const getWeather = async (zip, days = 5) => {
  addBreadcrumb('weather: forecast', 'external', { zip, days });
  return jsonGet(`${BASE_URL}/api/weather?zip=${encodeURIComponent(zip)}&days=${days}`);
};

const getRedditDiscussions = async (query) => {
  addBreadcrumb('reddit: search', 'external', { query });
  return jsonGet(`${BASE_URL}/api/reddit-discussions?query=${encodeURIComponent(query)}`);
};

const getSafetyData = async (chemical) => {
  addBreadcrumb('pubchem: lookup', 'external', { chemical });
  return jsonGet(`${BASE_URL}/api/safety-data?chemical=${encodeURIComponent(chemical)}`);
};

const getPropertyValueImpact = async ({ zip, repairType, estimatedCost }) => {
  const params = new URLSearchParams();
  if (zip) params.append('zip', zip);
  params.append('repairType', repairType || 'general');
  params.append('estimatedCost', String(estimatedCost || 0));
  addBreadcrumb('attom: value impact', 'external', { zip, repairType, estimatedCost });
  return jsonGet(`${BASE_URL}/api/property-value-impact?${params.toString()}`);
};

const uploadReceipt = async ({ base64Image, mimeType, projectId }) => {
  addBreadcrumb('mindee: receipt ocr', 'external', { projectId, mimeType });
  return jsonPost(`${BASE_URL}/api/receipt-ocr`, { base64Image, mimeType, projectId });
};

const matchPaintColor = async ({ base64Image, mimeType }) => {
  addBreadcrumb('paint: color match', 'external', { mimeType });
  return jsonPost(`${BASE_URL}/api/paint-color-match`, { base64Image, mimeType });
};

// Batch-translate an array of strings through the backend's Google Translate
// proxy. Used by I18nContext to dynamically translate the entire UI string
// table when the user picks a non-hardcoded language.
const translateStrings = async (texts, target, source = 'en') => {
  addBreadcrumb('translate: batch', 'external', { count: texts.length, target, source });
  const data = await jsonPost(`${BASE_URL}/api/translate`, { q: texts, target, source });
  return data.translations || [];
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
  translateStrings,
};
