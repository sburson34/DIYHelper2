// On-device object detection via ML Kit.
// Detects objects with bounding boxes for richer analysis context.

import { withMLKit } from './index';

let detectObjectsNative;
try {
  const mlkit = require('react-native-vision-camera-mlkit');
  detectObjectsNative = mlkit.detectObjects || mlkit.objectDetection;
} catch {
  detectObjectsNative = null;
}

/**
 * Run ML Kit object detection on a base64-encoded image.
 *
 * @param {string} base64 - Base64-encoded image data
 * @returns {Promise<Array<{ label: string, boundingBox: object }>>}
 */
export const detectObjects = async (base64) => {
  if (!detectObjectsNative || !base64) return [];

  return withMLKit('objectDetection', 'detect', async () => {
    const results = await detectObjectsNative(base64);
    if (!Array.isArray(results)) return [];

    return results
      .filter(r => r.labels && r.labels.length > 0)
      .map(r => ({
        label: r.labels[0]?.text || r.labels[0]?.label || 'object',
        boundingBox: r.boundingBox || r.frame || null,
        trackingId: r.trackingId || null,
      }))
      .slice(0, 10);
  }, []);
};

export const isObjectDetectionAvailable = () => detectObjectsNative != null;
