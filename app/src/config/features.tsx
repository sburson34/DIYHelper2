import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
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
  // ML Kit features (on-device)
  barcodeScanner: false,
  imageLabeling: false,
  onDeviceTranslation: false,
  digitalInk: false,
  entityExtraction: false,
  poseDetection: false,
};

const FeaturesContext = createContext<Features>(DEFAULT_FEATURES);

export const FeaturesProvider = ({ children }: { children: ReactNode }) => {
  const [features, setFeatures] = useState<Features>(DEFAULT_FEATURES);

  useEffect(() => {
    let mounted = true;
    getFeatures()
      .then((f: Partial<Features>) => { if (mounted) setFeatures({ ...DEFAULT_FEATURES, ...f }); })
      .catch(() => { /* keep defaults */ });
    return () => { mounted = false; };
  }, []);

  return (
    <FeaturesContext.Provider value={features}>
      {children}
    </FeaturesContext.Provider>
  );
};

export const useFeatures = (): Features => useContext(FeaturesContext);
