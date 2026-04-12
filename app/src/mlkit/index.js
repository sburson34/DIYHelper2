// Shared ML Kit utility layer.
// All ML Kit operations should go through these wrappers for consistent
// error handling, breadcrumbs, and graceful degradation.

import { Platform } from 'react-native';
import { addBreadcrumb, reportHandledError } from '../services/monitoring';

/**
 * Check if ML Kit native modules are likely available.
 * Returns false on web or when native modules fail to load.
 */
export const isMLKitAvailable = () => {
  return Platform.OS === 'android' || Platform.OS === 'ios';
};

/**
 * Wrap an ML Kit operation with breadcrumbs and error handling.
 * On failure, returns the provided default value instead of crashing.
 *
 * @param {string} feature - Feature name for logging (e.g. 'barcodeScanner')
 * @param {string} operation - Operation name (e.g. 'scan')
 * @param {Function} fn - Async function to execute
 * @param {*} defaultValue - Value to return on failure
 */
export const withMLKit = async (feature, operation, fn, defaultValue = null) => {
  addBreadcrumb(`mlkit: ${operation} starting`, 'mlkit', { feature });
  try {
    const result = await fn();
    addBreadcrumb(`mlkit: ${operation} complete`, 'mlkit', {
      feature,
      hasResult: result != null,
    });
    return result;
  } catch (error) {
    reportHandledError(`MLKit_${feature}_${operation}`, error, { feature, operation });
    return defaultValue;
  }
};

/**
 * Synchronous version of withMLKit for frame processor wrappers
 * and other non-async ML Kit calls.
 */
export const withMLKitSync = (feature, operation, fn, defaultValue = null) => {
  try {
    return fn();
  } catch (error) {
    reportHandledError(`MLKit_${feature}_${operation}`, error, { feature, operation });
    return defaultValue;
  }
};
