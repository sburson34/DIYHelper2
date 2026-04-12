// On-device translation via ML Kit.
// Downloads language models on first use for offline translation.

import { withMLKit } from './index';
import { addBreadcrumb } from '../services/monitoring';

let Translate;
try {
  Translate = require('@react-native-ml-kit/translate-text');
} catch {
  Translate = null;
}

// Cache translator instances to avoid re-creating them
const translatorCache = {};

const getTranslatorKey = (source, target) => `${source}-${target}`;

/**
 * Ensure a language model is downloaded for offline use.
 * @param {string} lang - Language code (e.g. 'es', 'fr')
 * @returns {Promise<boolean>} true if model is ready
 */
export const ensureModel = async (lang) => {
  if (!Translate) return false;
  return withMLKit('translation', 'ensureModel', async () => {
    const isDownloaded = Translate.isModelDownloaded
      ? await Translate.isModelDownloaded(lang)
      : false;
    if (isDownloaded) return true;
    if (Translate.downloadModel) {
      addBreadcrumb('mlkit: downloading language model', 'mlkit', { lang });
      await Translate.downloadModel(lang);
      return true;
    }
    return false;
  }, false);
};

/**
 * Check if a language model is already downloaded.
 */
export const isModelDownloaded = async (lang) => {
  if (!Translate || !Translate.isModelDownloaded) return false;
  try {
    return await Translate.isModelDownloaded(lang);
  } catch {
    return false;
  }
};

/**
 * Translate text from one language to another using on-device ML Kit.
 * @param {string} text - Text to translate
 * @param {string} sourceLang - Source language code (e.g. 'en')
 * @param {string} targetLang - Target language code (e.g. 'es')
 * @returns {Promise<string|null>} Translated text or null on failure
 */
export const translateText = async (text, sourceLang = 'en', targetLang = 'es') => {
  if (!Translate || !text) return null;

  return withMLKit('translation', 'translate', async () => {
    const key = getTranslatorKey(sourceLang, targetLang);

    if (!translatorCache[key]) {
      if (Translate.createTranslator) {
        translatorCache[key] = await Translate.createTranslator(sourceLang, targetLang);
      } else if (Translate.translate) {
        // Some versions have a direct translate function
        translatorCache[key] = { translate: (t) => Translate.translate(t, sourceLang, targetLang) };
      } else {
        return null;
      }
    }

    const result = await translatorCache[key].translate(text);
    return result || null;
  }, null);
};

/**
 * Translate an array of texts in batch.
 */
export const translateBatch = async (texts, sourceLang = 'en', targetLang = 'es') => {
  if (!texts || texts.length === 0) return [];
  const results = await Promise.all(
    texts.map(t => translateText(t, sourceLang, targetLang))
  );
  return results.map((r, i) => r || texts[i]); // fall back to original on failure
};

export const isTranslationAvailable = () => Translate != null;
