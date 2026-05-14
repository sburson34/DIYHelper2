// Play Integrity token fetcher.
//
// Wraps a native Play Integrity bridge (e.g. react-native-google-play-integrity)
// with a soft-require so the app still builds if the native module is not
// installed. The backend fails open when no token is presented, so the worst
// case of a missing native module is that the extra defense layer is absent.
//
// Setup checklist (keep in sync with docs/SECURITY_PLAYBOOK.md):
//   1. Install a Play Integrity native module and add EXPO_PUBLIC_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER.
//   2. Create a Google Cloud project, link it to Play Console, and enable
//      Play Integrity API. Copy the project *number* (not ID).
//   3. On the backend set PLAY_INTEGRITY_PROJECT_NUMBER and point
//      GOOGLE_APPLICATION_CREDENTIALS at a service account with the
//      playintegrity.googleapis.com scope.
//
// Until step 1 is done, requestIntegrityToken() returns null and the header
// is simply omitted.

const CLOUD_PROJECT_NUMBER = process.env.EXPO_PUBLIC_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER;

type IntegrityBridge = {
  requestIntegrityToken?: (args: { cloudProjectNumber: string; nonce?: string }) => Promise<string>;
};

let cachedBridge: IntegrityBridge | null | undefined = undefined;

const getBridge = (): IntegrityBridge | null => {
  if (cachedBridge !== undefined) return cachedBridge;
  try {
    // Soft require — if the module is not installed in this build, skip.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-google-play-integrity') as IntegrityBridge;
    cachedBridge = mod || null;
  } catch {
    cachedBridge = null;
  }
  return cachedBridge;
};

export const isIntegrityConfigured = (): boolean =>
  !!CLOUD_PROJECT_NUMBER && !!getBridge()?.requestIntegrityToken;

export const requestIntegrityToken = async (nonce?: string): Promise<string | null> => {
  if (!CLOUD_PROJECT_NUMBER) return null;
  const bridge = getBridge();
  if (!bridge?.requestIntegrityToken) return null;
  try {
    return await bridge.requestIntegrityToken({ cloudProjectNumber: CLOUD_PROJECT_NUMBER, nonce });
  } catch {
    return null;
  }
};
