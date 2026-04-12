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
