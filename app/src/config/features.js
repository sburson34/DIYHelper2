import React, { createContext, useContext, useEffect, useState } from 'react';
import { getFeatures } from '../api/backendClient';

const DEFAULT_FEATURES = {
  amazonPa: false,
  attom: false,
  paintColors: false,
  claudeFallback: false,
  youtube: false,
  weather: false,
  reddit: true,
  pubchem: true,
  receiptOcr: false,
};

const FeaturesContext = createContext(DEFAULT_FEATURES);

export const FeaturesProvider = ({ children }) => {
  const [features, setFeatures] = useState(DEFAULT_FEATURES);

  useEffect(() => {
    let mounted = true;
    getFeatures()
      .then((f) => { if (mounted) setFeatures({ ...DEFAULT_FEATURES, ...f }); })
      .catch(() => { /* keep defaults */ });
    return () => { mounted = false; };
  }, []);

  return (
    <FeaturesContext.Provider value={features}>
      {children}
    </FeaturesContext.Provider>
  );
};

export const useFeatures = () => useContext(FeaturesContext);
