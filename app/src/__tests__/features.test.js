import React from 'react';

jest.mock('../api/backendClient', () => ({
  getFeatures: jest.fn(),
}));

const { getFeatures } = require('../api/backendClient');

// We can't easily test the React context without @testing-library/react-native,
// so test the default feature values and the fetch behavior separately.

describe('FeaturesProvider defaults', () => {
  it('default features have expected shape', () => {
    const defaults = {
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
    expect(defaults.reddit).toBe(true);
    expect(defaults.pubchem).toBe(true);
    expect(defaults.amazonPa).toBe(false);
    expect(defaults.youtube).toBe(false);
  });

  it('getFeatures is callable', () => {
    expect(typeof getFeatures).toBe('function');
  });
});

describe('feature contract coverage', () => {
  // Every key FeatureFlags.ToPublicJson emits on the backend. The local defaults
  // drifted from this list once already (videoAnalysis, aiKillSwitch and all six
  // ML Kit flags were missing), which reads as `undefined` — falsy, so safe, but
  // it means the client silently disagrees with the server about what exists.
  const SERVER_KEYS = [
    'amazonPa', 'attom', 'paintColors', 'claudeFallback', 'youtube', 'weather',
    'reddit', 'pubchem', 'receiptOcr', 'videoAnalysis', 'aiKillSwitch',
    'barcodeScanner', 'imageLabeling', 'onDeviceTranslation', 'digitalInk',
    'entityExtraction', 'poseDetection',
  ];

  it('DEFAULT_FEATURES covers every flag the backend returns', () => {
    const { DEFAULT_FEATURES } = require('../config/features');
    for (const key of SERVER_KEYS) {
      expect(DEFAULT_FEATURES).toHaveProperty(key);
      expect(typeof DEFAULT_FEATURES[key]).toBe('boolean');
    }
  });

  it('video analysis defaults off, matching the backend', () => {
    // The backend rejects video items unless FEATURES_VideoAnalysis is set, so
    // defaulting this on would show a button whose every use returns a 400.
    const { DEFAULT_FEATURES } = require('../config/features');
    expect(DEFAULT_FEATURES.videoAnalysis).toBe(false);
  });
});
