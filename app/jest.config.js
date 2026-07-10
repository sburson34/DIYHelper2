module.exports = {
  preset: 'react-native',
  // Defensive: react-native Animated.timing leaks setTimeout callbacks
  // through node_modules/react-native/jest/setup.js that don't drain in
  // the jest mock environment. Without forceExit, jest sits after the
  // test loop completes, waiting on those open timer handles until the
  // CI runner kills the job at timeout-minutes. PianoHelper #20 surfaced
  // this with a 20-min stall on a 1-min test suite; applying portfolio-
  // wide so the same trap doesn't catch the next mobile app to add an
  // Animated.View.
  forceExit: true,
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|@sburson34|expo|@expo|@sentry/react-native|expo-constants|expo-notifications|expo-camera|expo-image-picker|expo-speech-recognition|expo-audio|expo-splash-screen|expo-print|expo-sharing|react-native-gesture-handler|react-native-reanimated|react-native-screens|react-native-safe-area-context|react-native-tts|react-native-image-picker|react-native-vision-camera)/)',
  ],
  // `setupFilesAfterEnv` runs after the test framework is installed in the
  // environment, so `expect` / `jest` globals are defined when the shared
  // mock loader (which transitively imports @testing-library/react-native →
  // expect.extend()) runs. Plain `setupFiles` runs before the framework and
  // would explode with `ReferenceError: expect is not defined`.
  setupFilesAfterEnv: ['./jest.setup.js'],
  testMatch: ['**/src/__tests__/**/*.test.{js,ts,tsx}'],
  moduleNameMapper: {
    '\\.(png|jpg|jpeg|gif|svg)$': '<rootDir>/jest.setup.js',
  },
  // Coverage settings — only enabled when `npm run test:coverage` is used.
  // Focused on the business-logic paths that matter for regression protection;
  // screens and navigation shells are intentionally excluded because their
  // rendering is already exercised by the .nav and .smoke test suites.
  collectCoverageFrom: [
    'src/api/**/*.{ts,tsx,js,jsx}',
    'src/utils/**/*.{ts,tsx,js,jsx}',
    'src/services/**/*.{ts,tsx,js,jsx}',
    'src/i18n/**/*.{ts,tsx,js,jsx}',
    'src/config/**/*.{ts,tsx,js,jsx}',
    'src/ThemeContext.{ts,tsx}',
    '!**/*.d.ts',
    '!**/__tests__/**',
    '!**/__mocks__/**',
    '!**/index.{ts,tsx,js,jsx}',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov', 'cobertura', 'json-summary'],
  // Thresholds represent a "floor" — if this drops below these numbers we know
  // real regression protection is slipping. Chosen to match current real
  // coverage so the gate is meaningful, not aspirational.
  coverageThreshold: {
    global: {
      branches: 55,
      functions: 65,
      lines: 70,
      statements: 70,
    },
  },
};
