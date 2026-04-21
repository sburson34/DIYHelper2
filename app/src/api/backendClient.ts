import { API_BASE_URL } from '../config/api';
import { getCachedAnalysis, setCachedAnalysis, getAppPrefs, getToolInventory } from '../utils/storage';
import { reportError, reportHandledError, addBreadcrumb } from '../services/monitoring';
import { RELEASE } from '../config/appInfo';

const BASE_URL = API_BASE_URL;

// ── Types ─────────────────────────────────────────────────────────────

export interface ApiError extends Error {
  status?: number;
  correlationId?: string;
  durationMs?: number;
}

export interface MediaItem {
  base64?: string;
  mimeType?: string;
  uri?: string;
  [extra: string]: unknown;
}

export interface AnalysisResult {
  title?: string;
  steps?: string[];
  tools_and_materials?: string[];
  difficulty?: string;
  estimated_time?: string;
  estimated_cost?: string;
  youtube_links?: unknown[];
  shopping_links?: Array<string | { item: string; url?: string; amazon_url?: string; homedepot_url?: string }>;
  safety_tips?: string[];
  when_to_call_pro?: string[];
  repair_type?: string;
  _fromCache?: boolean;
  _cachedAt?: string;
  [extra: string]: unknown;
}

export interface DiagnoseResult {
  urgency?: 'low' | 'medium' | 'high' | 'emergency' | string;
  summary?: string;
  possible_causes?: Array<{
    issue: string;
    likelihood: 'low' | 'medium' | 'high' | string;
    why?: string;
    next_check?: string;
  }>;
  [extra: string]: unknown;
}

export interface HelpRequestInput {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  projectTitle?: string;
  userDescription?: string;
  projectData?: unknown;
  imageBase64?: string;
}

export interface HelpRequestRecord {
  id: number | string;
  status: string;
  createdAt?: string;
  projectTitle?: string;
  userDescription?: string;
  notes?: string;
  [extra: string]: unknown;
}

export type Language = 'en' | 'es' | string;

// ── Correlation ID ────────────────────────────────────────────────────
let counter = 0;
const generateCorrelationId = (): string => {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}-${rand}-${++counter}`;
};

// ── Instrumented fetch ────────────────────────────────────────────────
// Every outbound request gets a correlation ID, timing, and breadcrumbs.
const apiFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const correlationId = generateCorrelationId();
  const method = options.method || 'GET';
  const path = url.replace(BASE_URL, '');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Correlation-ID': correlationId,
    'X-App-Version': RELEASE,
    ...(options.headers as Record<string, string> | undefined),
  };

  addBreadcrumb(`${method} ${path}`, 'http', {
    url: path,
    method,
    correlationId,
  });

  const start = Date.now();
  let status: number | undefined;
  try {
    const response = await fetch(url, { ...options, headers });
    status = response.status;
    const durationMs = Date.now() - start;

    if (!response.ok) {
      let errorMessage: string | undefined;
      try {
        const body = await response.json();
        errorMessage = (body as { error?: string; message?: string }).error
          || (body as { error?: string; message?: string }).message;
      } catch {}

      const summary = errorMessage || `HTTP ${status}`;
      addBreadcrumb(`${method} ${path} failed: ${summary}`, 'http', {
        url: path, method, status, durationMs, correlationId,
      });
      const err = new Error(summary) as ApiError;
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
    const apiErr = error as ApiError;
    // Network-level failure (no response at all)
    if (!status) {
      addBreadcrumb(`${method} ${path} network error`, 'http', {
        url: path, method, durationMs, correlationId,
        error: apiErr.message,
      });
    }
    if (!apiErr.correlationId) {
      apiErr.correlationId = correlationId;
      apiErr.durationMs = durationMs;
    }
    throw apiErr;
  }
};

// Convenience: POST JSON body → parsed JSON response
const jsonPost = async <T = unknown>(url: string, body: unknown): Promise<T> => {
  const response = await apiFetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return response.json() as Promise<T>;
};

// Convenience: GET → parsed JSON response
const jsonGet = async <T = unknown>(url: string): Promise<T> => {
  const response = await apiFetch(url);
  return response.json() as Promise<T>;
};

// Convenience: PUT JSON body → parsed JSON response
const jsonPut = async <T = unknown>(url: string, body: unknown): Promise<T> => {
  const response = await apiFetch(url, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return response.json() as Promise<T>;
};

// ── Endpoints ─────────────────────────────────────────────────────────

const analyzeProject = async (
  description: string,
  mediaItems: MediaItem[] = [],
  language: Language = 'en',
): Promise<AnalysisResult> => {
  const url = `${BASE_URL}/api/analyze`;
  const prefs = await getAppPrefs().catch(() => ({} as Partial<{ skillLevel: string; zip: string }>));
  const inventory = await getToolInventory().catch(() => []);

  addBreadcrumb('AI: analyze project', 'ai', {
    action: 'analyze',
    descriptionLength: description?.length ?? 0,
    mediaCount: mediaItems.length,
    language,
  });

  try {
    const result = await jsonPost<AnalysisResult>(url, {
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
    const apiErr = error as ApiError;
    console.error('Error in analyzeProject detail:', apiErr);
    const cached = await getCachedAnalysis(description, mediaItems.length);
    if (cached) {
      reportHandledError('AnalysisFallbackToCache', apiErr, {
        mediaCount: mediaItems.length,
        cacheAge: Date.now() - new Date(cached.cachedAt).getTime(),
        correlationId: apiErr.correlationId,
      });
      return { ...(cached.result as AnalysisResult), _fromCache: true, _cachedAt: cached.cachedAt };
    }
    if (apiErr.message === 'Network request failed') {
      reportError(apiErr, {
        source: 'backendClient',
        operation: 'analyzeProject',
        extra: { url, mediaCount: mediaItems.length, correlationId: apiErr.correlationId },
      });
      throw new Error(`Network error! Hit ${url} and it failed. Check adb reverse tcp:5206 tcp:5206 and that backend is running.`);
    }
    reportError(apiErr, {
      source: 'backendClient',
      operation: 'analyzeProject',
      extra: { correlationId: apiErr.correlationId },
    });
    throw apiErr;
  }
};

const askHelper = async (
  question: string,
  project: unknown,
  language: Language = 'en',
): Promise<unknown> => {
  addBreadcrumb('AI: ask helper', 'ai', {
    action: 'ask-helper',
    questionLength: question?.length ?? 0,
    language,
  });
  return jsonPost(`${BASE_URL}/api/ask-helper`, { question, projectContext: project, language });
};

interface VerifyStepArgs {
  stepText: string;
  projectTitle?: string;
  base64Image?: string;
  mimeType?: string;
  language?: Language;
}

const verifyStep = async ({ stepText, projectTitle, base64Image, mimeType, language = 'en' }: VerifyStepArgs): Promise<unknown> => {
  addBreadcrumb('AI: verify step', 'ai', {
    action: 'verify-step',
    hasImage: !!base64Image,
    language,
  });
  return jsonPost(`${BASE_URL}/api/verify-step`, { stepText, projectTitle, base64Image, mimeType, language });
};

interface DiagnoseArgs {
  description: string;
  media?: MediaItem[];
  language?: Language;
}

const diagnoseProblem = async ({ description, media = [], language = 'en' }: DiagnoseArgs): Promise<DiagnoseResult> => {
  addBreadcrumb('AI: diagnose', 'ai', {
    action: 'diagnose',
    descriptionLength: description?.length ?? 0,
    mediaCount: media.length,
    language,
  });
  return jsonPost<DiagnoseResult>(`${BASE_URL}/api/diagnose`, { description, media, language });
};

const getClarifyingQuestions = async ({ description, media = [], language = 'en' }: DiagnoseArgs): Promise<unknown> => {
  addBreadcrumb('AI: clarify', 'ai', {
    action: 'clarify',
    descriptionLength: description?.length ?? 0,
    mediaCount: media.length,
    language,
  });
  return jsonPost(`${BASE_URL}/api/clarify`, { description, media, language });
};

const submitHelpRequest = async ({ customerName, customerEmail, customerPhone, projectTitle, userDescription, projectData, imageBase64 }: HelpRequestInput): Promise<HelpRequestRecord> => {
  return jsonPost<HelpRequestRecord>(`${BASE_URL}/api/help-requests`, {
    customerName,
    customerEmail,
    customerPhone,
    projectTitle,
    userDescription,
    projectData: typeof projectData === 'string' ? projectData : JSON.stringify(projectData || {}),
    imageBase64,
  });
};

const getHelpRequest = async (id: string | number): Promise<HelpRequestRecord> => {
  return jsonGet<HelpRequestRecord>(`${BASE_URL}/api/help-requests/${id}`);
};

const updateHelpRequestStatus = async (id: string | number, status: string, notes?: string): Promise<HelpRequestRecord> => {
  return jsonPut<HelpRequestRecord>(`${BASE_URL}/api/help-requests/${id}`, { status, notes });
};

const listHelpRequests = async (status?: string): Promise<HelpRequestRecord[]> => {
  const url = status
    ? `${BASE_URL}/api/help-requests?status=${encodeURIComponent(status)}`
    : `${BASE_URL}/api/help-requests`;
  return jsonGet<HelpRequestRecord[]>(url);
};

export interface CommunityProject {
  id?: string;
  title: string;
  description?: string;
  difficulty?: string;
  estimated_time?: string;
  estimated_cost?: string;
  [extra: string]: unknown;
}

const submitCommunityProject = async (project: CommunityProject): Promise<unknown> => {
  return jsonPost(`${BASE_URL}/api/community-projects`, project);
};

const browseCommunityProjects = async (query = ''): Promise<CommunityProject[]> => {
  const url = query
    ? `${BASE_URL}/api/community-projects?q=${encodeURIComponent(query)}`
    : `${BASE_URL}/api/community-projects`;
  return jsonGet<CommunityProject[]>(url);
};

// ── External API integrations ─────────────────────────────────────
// Each call goes through the instrumented apiFetch above so correlation IDs
// and breadcrumbs cover the new endpoints too. Failures return sane defaults
// where that keeps the UI from breaking on a partial outage.

const FEATURES_FALLBACK = {
  amazonPa: false, attom: false, paintColors: false, claudeFallback: false,
  youtube: false, weather: false, reddit: true, pubchem: true, receiptOcr: false,
};

const getFeatures = async (): Promise<Record<string, boolean>> => {
  try {
    return await jsonGet<Record<string, boolean>>(`${BASE_URL}/api/features`);
  } catch {
    return { ...FEATURES_FALLBACK };
  }
};

const getWeather = async (zip: string, days = 5): Promise<unknown> => {
  addBreadcrumb('weather: forecast', 'external', { zip, days });
  return jsonGet(`${BASE_URL}/api/weather?zip=${encodeURIComponent(zip)}&days=${days}`);
};

export interface RedditDiscussionsResponse {
  threads?: Array<{
    title: string;
    url?: string;
    upvotes?: number;
    numComments?: number;
    [extra: string]: unknown;
  }>;
}

const getRedditDiscussions = async (query: string): Promise<RedditDiscussionsResponse> => {
  addBreadcrumb('reddit: search', 'external', { query });
  return jsonGet<RedditDiscussionsResponse>(`${BASE_URL}/api/reddit-discussions?query=${encodeURIComponent(query)}`);
};

const getSafetyData = async (chemical: string): Promise<unknown> => {
  addBreadcrumb('pubchem: lookup', 'external', { chemical });
  return jsonGet(`${BASE_URL}/api/safety-data?chemical=${encodeURIComponent(chemical)}`);
};

interface PropertyValueArgs {
  zip?: string;
  repairType?: string;
  estimatedCost?: number;
}

const getPropertyValueImpact = async ({ zip, repairType, estimatedCost }: PropertyValueArgs): Promise<unknown> => {
  const params = new URLSearchParams();
  if (zip) params.append('zip', zip);
  params.append('repairType', repairType || 'general');
  params.append('estimatedCost', String(estimatedCost || 0));
  addBreadcrumb('attom: value impact', 'external', { zip, repairType, estimatedCost });
  return jsonGet(`${BASE_URL}/api/property-value-impact?${params.toString()}`);
};

interface UploadReceiptArgs {
  base64Image: string;
  mimeType: string;
  projectId?: string;
}

const uploadReceipt = async ({ base64Image, mimeType, projectId }: UploadReceiptArgs): Promise<unknown> => {
  addBreadcrumb('mindee: receipt ocr', 'external', { projectId, mimeType });
  return jsonPost(`${BASE_URL}/api/receipt-ocr`, { base64Image, mimeType, projectId });
};

interface PaintColorArgs {
  base64Image: string;
  mimeType: string;
}

const matchPaintColor = async ({ base64Image, mimeType }: PaintColorArgs): Promise<unknown> => {
  addBreadcrumb('paint: color match', 'external', { mimeType });
  return jsonPost(`${BASE_URL}/api/paint-color-match`, { base64Image, mimeType });
};

// Batch-translate an array of strings through the backend's Google Translate
// proxy. Used by I18nContext to dynamically translate the entire UI string
// table when the user picks a non-hardcoded language.
const translateStrings = async (
  texts: string[],
  target: string,
  source = 'en',
): Promise<string[]> => {
  addBreadcrumb('translate: batch', 'external', { count: texts.length, target, source });
  const data = await jsonPost<{ translations?: string[] }>(`${BASE_URL}/api/translate`, { q: texts, target, source });
  return data.translations || [];
};

interface DeletionArgs {
  name?: string;
  email?: string;
  phone?: string;
}

export interface DeletionResponse {
  status?: string;
  requestId?: string;
  [extra: string]: unknown;
}

// Server-side deletion request.
//
// Expected backend contract (see docs/backend-deletion-endpoint.md):
//   POST /api/delete-user-data
//   Body: { name?: string, email?: string, phone?: string, release?: string }
//   Success: 200 { status: 'queued', requestId: string }
//   Auth flow: backend SHOULD email `email` a confirmation link; only acts on verified requests.
//   SLA: permanent deletion within 30 days of verification (matches privacy policy).
//
// The caller should handle rejections (network error / 404 / 5xx) by falling back
// to a mailto: link so the user still has a path to request deletion.
const requestServerSideDeletion = async ({ name, email, phone }: DeletionArgs): Promise<DeletionResponse> => {
  addBreadcrumb('privacy: request server-side deletion', 'user.action', {
    hasEmail: !!email,
    hasPhone: !!phone,
  });
  return jsonPost<DeletionResponse>(`${BASE_URL}/api/delete-user-data`, {
    name: name || '',
    email: email || '',
    phone: phone || '',
  });
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
  requestServerSideDeletion,
};
