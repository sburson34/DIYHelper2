import { API_BASE_URL } from '../config/api';
import { getCachedAnalysis, setCachedAnalysis, getAppPrefs, getToolInventory, getAiConsent, getOrCreateDeviceId } from '../utils/storage';
import { reportError, reportHandledError, addBreadcrumb } from '../services/monitoring';
import { requestIntegrityToken } from '../services/playIntegrity';
import { RELEASE, BRAND_ID } from '../config/appInfo';

// Endpoints that warrant the extra latency of a Play Integrity attestation.
// Keep this tight — every integrity call takes ~1–3s on a cold fetch, so
// apply only where bot abuse is expensive ($$/OpenAI tokens).
const INTEGRITY_PATHS = ['/api/analyze', '/api/ask-helper', '/api/live-diy/analyze'];

const BASE_URL = API_BASE_URL;

// Shared-secret header. Inlined at build time via EXPO_PUBLIC_APP_KEY so release
// builds carry it without it being editable at runtime. Undefined in local dev,
// in which case the backend middleware is also a no-op (matched pair).
const APP_KEY: string | undefined = process.env.EXPO_PUBLIC_APP_KEY;

// Thrown when an AI-using code path is invoked but the user declined the
// AI consent disclosure. Callers should catch and surface a message rather
// than treating it as a network error.
export class AiConsentRequiredError extends Error {
  constructor() {
    super('AI features are disabled. Enable them in Settings to continue.');
    this.name = 'AiConsentRequiredError';
  }
}

const ensureAiConsent = async (): Promise<void> => {
  const c = await getAiConsent();
  if (!c || !c.granted) throw new AiConsentRequiredError();
};

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

export interface LiveAnalysisRequest {
  taskDescription?: string;
  currentStep?: number;
  userQuestion?: string;
  imageBase64?: string;
  mimeType?: string;
  sessionId?: string;
}

export interface LiveAnalysisResult {
  currentAssessment: string;
  nextInstruction: string;
  safetyWarnings: string[];
  confidenceScore: number;
  shouldEscalateToProfessional: boolean;
  escalationReason?: string;
  suggestedTools: string[];
  sessionId: string;
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
// A client-side timeout is essential: without it, a stalled TCP connection
// (cell handoff, captive portal) leaves the upload spinner hanging forever.
// Backend's 2-minute OpenAI timeout bounds happy-path latency, so we match it.
const DEFAULT_TIMEOUT_MS = 120_000;

const apiFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const correlationId = generateCorrelationId();
  const method = options.method || 'GET';
  const path = url.replace(BASE_URL, '');
  const deviceId = await getOrCreateDeviceId();

  let integrityToken: string | null = null;
  if (INTEGRITY_PATHS.some(p => path.startsWith(p))) {
    integrityToken = await requestIntegrityToken(correlationId);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Correlation-ID': correlationId,
    'X-App-Version': RELEASE,
    'X-Brand': BRAND_ID,
    'X-Device-Id': deviceId,
    ...(APP_KEY ? { 'X-App-Key': APP_KEY } : {}),
    ...(integrityToken ? { 'X-Play-Integrity-Token': integrityToken } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };

  addBreadcrumb(`${method} ${path}`, 'http', {
    url: path,
    method,
    correlationId,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  const start = Date.now();
  let status: number | undefined;
  try {
    const response = await fetch(url, { ...options, headers, signal: controller.signal });
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
    // Network-level failure (no response at all) or client-side timeout.
    if (!status) {
      const isAbort = (apiErr as { name?: string })?.name === 'AbortError';
      addBreadcrumb(`${method} ${path} ${isAbort ? 'timed out' : 'network error'}`, 'http', {
        url: path, method, durationMs, correlationId,
        error: apiErr.message,
      });
      if (isAbort) {
        apiErr.message = 'Request timed out. Please check your connection and try again.';
      }
    }
    if (!apiErr.correlationId) {
      apiErr.correlationId = correlationId;
      apiErr.durationMs = durationMs;
    }
    throw apiErr;
  } finally {
    clearTimeout(timeout);
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
  await ensureAiConsent();
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
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('Error in analyzeProject detail:', apiErr);
    }
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
      // Dev builds get the adb-reverse hint; prod users get a user-facing message.
      throw new Error(__DEV__
        ? `Network error! Hit ${url} and it failed. Check adb reverse tcp:5206 tcp:5206 and that backend is running.`
        : 'Unable to reach DIY Helper. Please check your internet connection and try again.');
    }
    reportError(apiErr, {
      source: 'backendClient',
      operation: 'analyzeProject',
      extra: { correlationId: apiErr.correlationId },
    });
    throw apiErr;
  }
};

// Live DIY Coach — single-turn realtime coaching. Each call is one camera frame
// + the surrounding session context (task, current step, user's question). The
// backend does all safety filtering and may force shouldEscalateToProfessional
// for high-risk categories regardless of what the model returned.
const analyzeLive = async (input: LiveAnalysisRequest): Promise<LiveAnalysisResult> => {
  await ensureAiConsent();
  addBreadcrumb('AI: live diy', 'ai', {
    action: 'live-diy-analyze',
    hasImage: !!input.imageBase64,
    hasQuestion: !!input.userQuestion,
    currentStep: input.currentStep,
    sessionId: input.sessionId,
  });
  return jsonPost<LiveAnalysisResult>(`${BASE_URL}/api/live-diy/analyze`, input);
};

const askHelper = async (
  question: string,
  project: unknown,
  language: Language = 'en',
): Promise<unknown> => {
  await ensureAiConsent();
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
  await ensureAiConsent();
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
  await ensureAiConsent();
  addBreadcrumb('AI: diagnose', 'ai', {
    action: 'diagnose',
    descriptionLength: description?.length ?? 0,
    mediaCount: media.length,
    language,
  });
  return jsonPost<DiagnoseResult>(`${BASE_URL}/api/diagnose`, { description, media, language });
};

const getClarifyingQuestions = async ({ description, media = [], language = 'en' }: DiagnoseArgs): Promise<unknown> => {
  await ensureAiConsent();
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

// Second half of the verified deletion flow. User enters the 6-digit code
// emailed by the backend; server marks the deletion request verified.
const confirmServerSideDeletion = async (requestId: string, code: string): Promise<DeletionResponse> => {
  addBreadcrumb('privacy: confirm server-side deletion', 'user.action', { requestId });
  return jsonPost<DeletionResponse>(`${BASE_URL}/api/confirm-deletion`, { requestId, code });
};

// ── Promotional push notifications ────────────────────────────────────
// Register this device's Expo push token so the branding company can send it
// promotional notifications. Brand + device id ride along automatically as the
// X-Brand / X-Device-Id headers (set in apiFetch), so the backend keys the
// token to the right tenant without the client passing either.
const registerPushToken = async (
  token: string,
  platform: string,
  marketingOptIn: boolean,
): Promise<unknown> => {
  addBreadcrumb('push: register token', 'user.action', { platform, marketingOptIn });
  return jsonPost(`${BASE_URL}/api/push/register`, { token, platform, marketingOptIn });
};

// Opt this device out of promotional pushes (Settings toggle off). Best-effort.
const unregisterPushToken = async (token: string): Promise<unknown> => {
  addBreadcrumb('push: unregister token', 'user.action', {});
  return jsonPost(`${BASE_URL}/api/push/unregister`, { token });
};

export {
  analyzeProject,
  analyzeLive,
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
  confirmServerSideDeletion,
  registerPushToken,
  unregisterPushToken,
};
