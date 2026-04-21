module.exports = {
  root: true,
  extends: ['@react-native'],
  ignorePatterns: [
    'node_modules/',
    'android/',
    'ios/',
    'build/',
    'dist/',
    'coverage/',
    '*.config.js',
    'babel.config.js',
    'metro.config.js',
    'jest.setup.js',
    'scripts/',
  ],
  overrides: [
    {
      files: ['**/__tests__/**/*', '**/*.test.{js,jsx,ts,tsx}'],
      env: { jest: true },
    },
  ],
};
