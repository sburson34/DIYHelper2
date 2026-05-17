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
  // ML Kit features (on-device)
  barcodeScanner: boolean;
  imageLabeling: boolean;
  onDeviceTranslation: boolean;
  digitalInk: boolean;
  entityExtraction: boolean;
  poseDetection: boolean;
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
