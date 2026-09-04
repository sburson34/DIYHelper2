import { createFeatureFlags } from '@sburson34/mobile-shared/feature-flags';
import { getFeatures } from '../api/backendClient';

export interface Features {
  amazonPa: boolean;
  attom: boolean;
  paintColors: boolean;
  claudeFallback: boolean;
  youtube: boolean;
  weather: boolean;
  reddit: boolean;
  pubchem: boolean;
  receiptOcr: boolean;
  // Video capture. Off unless the backend has a frame-extraction pipeline —
  // /api/analyze rejects video items with 400 video_not_supported otherwise, so
  // the UI must not offer the button when this is false.
  videoAnalysis: boolean;
  // Fleet-wide emergency stop on every AI endpoint.
  aiKillSwitch: boolean;
  // ML Kit features (on-device)
  barcodeScanner: boolean;
  imageLabeling: boolean;
  onDeviceTranslation: boolean;
  digitalInk: boolean;
  entityExtraction: boolean;
  poseDetection: boolean;
  // createFeatureFlags constrains its type parameter to Record<string, unknown>,
  // and a TS interface — unlike a type alias — gets no implicit index signature,
  // so without this the factory call below fails to typecheck. Also lets a flag
  // the backend adds be read before this interface catches up. Mirrors
  // BrandConfigFeatures in api/backendClient.ts.
  [extra: string]: boolean;
}

const DEFAULT_FEATURES: Features = {
  amazonPa: false,
  attom: false,
  paintColors: false,
  claudeFallback: false,
  youtube: false,
  weather: false,
  reddit: true,
  pubchem: true,
  receiptOcr: false,
  videoAnalysis: false,
  aiKillSwitch: false,
  barcodeScanner: false,
  imageLabeling: false,
  onDeviceTranslation: false,
  digitalInk: false,
  entityExtraction: false,
  poseDetection: false,
};

const { FeaturesProvider, useFeatures } = createFeatureFlags<Features>(
  DEFAULT_FEATURES,
  { fetcher: () => getFeatures() as Promise<Partial<Features>> },
);

export { FeaturesProvider, useFeatures, DEFAULT_FEATURES };
