// On-device image labeling via ML Kit.
// Classifies photo content (e.g. "faucet", "drywall", "electrical panel")
// to enhance GPT-4o prompts with structured context.

import { withMLKit } from './index';

let labelImageNative;
try {
  const mlkit = require('react-native-vision-camera-mlkit');
  labelImageNative = mlkit.labelImage || mlkit.imageLabeling;
} catch {
  labelImageNative = null;
}

/**
 * Run ML Kit image labeling on a base64-encoded image.
 * Returns an array of labels with confidence scores.
 *
 * @param {string} base64 - Base64-encoded image data
 * @returns {Promise<Array<{ label: string, confidence: number }>>}
 */
export const labelImage = async (base64) => {
  if (!labelImageNative || !base64) return [];

  return withMLKit('imageLabeling', 'label', async () => {
    const results = await labelImageNative(base64);
    if (!Array.isArray(results)) return [];

    return results
      .filter(r => (r.confidence || r.score || 0) > 0.5)
      .map(r => ({
        label: r.label || r.text || r.name || 'unknown',
        confidence: Math.round((r.confidence || r.score || 0) * 100) / 100,
      }))
      .slice(0, 10); // cap at 10 labels
  }, []);
};

export const isImageLabelingAvailable = () => labelImageNative != null;
