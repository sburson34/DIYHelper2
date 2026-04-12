// Digital ink recognition via ML Kit.
// Converts freehand strokes into recognized text/shapes.

import { withMLKit } from './index';

let recognizeInkNative;
try {
  const mlkit = require('react-native-vision-camera-mlkit');
  recognizeInkNative = mlkit.recognizeInk || mlkit.digitalInkRecognition;
} catch {
  recognizeInkNative = null;
}

/**
 * Run ML Kit digital ink recognition on an array of strokes.
 *
 * @param {Array<{ points: Array<{ x: number, y: number, t: number }> }>} strokes
 * @returns {Promise<Array<{ text: string, score: number }>>}
 */
export const recognizeInk = async (strokes) => {
  if (!recognizeInkNative || !strokes || strokes.length === 0) return [];

  return withMLKit('digitalInk', 'recognize', async () => {
    const results = await recognizeInkNative(strokes);
    if (!Array.isArray(results)) return [];

    return results
      .map(r => ({
        text: r.text || r.value || '',
        score: r.score || r.confidence || 0,
      }))
      .filter(r => r.text)
      .slice(0, 5);
  }, []);
};

export const isDigitalInkAvailable = () => recognizeInkNative != null;
