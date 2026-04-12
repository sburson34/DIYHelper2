// On-device entity extraction via ML Kit.
// Extracts dates, money, phone numbers, addresses, and measurements from text.

import { withMLKit } from './index';

let EntityExtractor;
try {
  EntityExtractor = require('react-native-mlkit-entity-extraction');
} catch {
  EntityExtractor = null;
}

/**
 * Extract structured entities from text.
 *
 * @param {string} text - Text to analyze
 * @returns {Promise<Array<{ type: string, text: string, start: number, end: number }>>}
 */
export const extractEntities = async (text) => {
  if (!EntityExtractor || !text || text.length < 3) return [];

  return withMLKit('entityExtraction', 'extract', async () => {
    const extract = EntityExtractor.extractEntities || EntityExtractor.default?.extractEntities;
    if (!extract) return [];

    const results = await extract(text);
    if (!Array.isArray(results)) return [];

    // Filter to useful entity types for DIY context
    const USEFUL_TYPES = ['TYPE_DATE_TIME', 'TYPE_MONEY', 'TYPE_PHONE', 'TYPE_ADDRESS',
      'date', 'money', 'phone', 'address', 'datetime', 'measurement',
      'DATE_TIME', 'MONEY', 'PHONE', 'ADDRESS'];

    return results
      .filter(r => {
        const type = (r.type || r.entityType || '').toUpperCase();
        return USEFUL_TYPES.some(t => type.includes(t.toUpperCase()));
      })
      .map(r => ({
        type: normalizeType(r.type || r.entityType || 'unknown'),
        text: r.text || r.annotatedText || text.substring(r.start || 0, r.end || 0),
        start: r.start || r.startIndex || 0,
        end: r.end || r.endIndex || 0,
      }))
      .slice(0, 8);
  }, []);
};

const normalizeType = (type) => {
  const t = type.toLowerCase();
  if (t.includes('date') || t.includes('time')) return 'date';
  if (t.includes('money') || t.includes('price')) return 'money';
  if (t.includes('phone')) return 'phone';
  if (t.includes('address')) return 'address';
  if (t.includes('measure')) return 'measurement';
  return 'other';
};

export const isEntityExtractionAvailable = () => EntityExtractor != null;
