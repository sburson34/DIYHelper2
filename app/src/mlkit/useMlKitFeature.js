// Hook that combines feature flags with platform capability checks.
// Use this to conditionally render ML Kit UI elements.

import { useMemo } from 'react';
import { useFeatures } from '../config/features';
import { isMLKitAvailable } from './index';

/**
 * Check if a specific ML Kit feature is both enabled (feature flag)
 * and available (platform support).
 *
 * @param {string} featureKey - Key from the features object (e.g. 'barcodeScanner')
 * @returns {{ enabled: boolean, available: boolean, ready: boolean }}
 */
export const useMlKitFeature = (featureKey) => {
  const features = useFeatures();

  return useMemo(() => {
    const enabled = !!features[featureKey];
    const available = isMLKitAvailable();
    return {
      enabled,
      available,
      ready: enabled && available, // both must be true to use the feature
    };
  }, [features, featureKey]);
};
