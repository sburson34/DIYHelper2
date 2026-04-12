const {getDefaultConfig} = require('expo/metro-config');
const {mergeConfig} = require('@react-native/metro-config');
const {getSentryExpoConfig} = require('@sentry/react-native/metro');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * Wrapped with getSentryExpoConfig so release/beta builds emit a debug-id
 * and source maps that can be uploaded to Sentry by the @sentry/react-native/expo
 * config plugin.
 *
 * @type {import('metro-config').MetroConfig}
 */

const config = getSentryExpoConfig(__dirname);

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
