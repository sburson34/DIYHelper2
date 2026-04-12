// React context for on-device ML Kit translation.
// Provides translate/isModelReady/downloadProgress to descendant components.

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useMlKitFeature } from './useMlKitFeature';
import { translateText, translateBatch, ensureModel, isModelDownloaded, isTranslationAvailable } from './translation';

const TranslationContext = createContext({
  translate: async () => null,
  translateBatch: async (texts) => texts,
  isModelReady: false,
  isDownloading: false,
  downloadModel: async () => false,
  available: false,
});

export const TranslationProvider = ({ targetLang = 'es', children }) => {
  const { ready } = useMlKitFeature('onDeviceTranslation');
  const available = ready && isTranslationAvailable();

  const [isModelReady, setIsModelReady] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // Check if model is already downloaded on mount
  useEffect(() => {
    if (!available) return;
    isModelDownloaded(targetLang).then(setIsModelReady);
  }, [available, targetLang]);

  const downloadModel = useCallback(async () => {
    if (!available) return false;
    setIsDownloading(true);
    try {
      const success = await ensureModel(targetLang);
      setIsModelReady(success);
      return success;
    } finally {
      setIsDownloading(false);
    }
  }, [available, targetLang]);

  const translate = useCallback(async (text, sourceLang = 'en') => {
    if (!available || !isModelReady) return null;
    return translateText(text, sourceLang, targetLang);
  }, [available, isModelReady, targetLang]);

  const batchTranslate = useCallback(async (texts, sourceLang = 'en') => {
    if (!available || !isModelReady) return texts;
    return translateBatch(texts, sourceLang, targetLang);
  }, [available, isModelReady, targetLang]);

  return (
    <TranslationContext.Provider value={{
      translate,
      translateBatch: batchTranslate,
      isModelReady,
      isDownloading,
      downloadModel,
      available,
    }}>
      {children}
    </TranslationContext.Provider>
  );
};

export const useMLTranslation = () => useContext(TranslationContext);
