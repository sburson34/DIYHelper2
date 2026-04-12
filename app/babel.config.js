module.exports = function (api) {
  api.cache(true);
  const plugins = ['react-native-reanimated/plugin'];
  // react-native-worklets/plugin is needed for ML Kit frame processors
  // but breaks Jest transforms, so only include in non-test environments
  if (process.env.NODE_ENV !== 'test') {
    plugins.unshift('react-native-worklets/plugin');
  }
  return {
    presets: ['babel-preset-expo'],
    plugins,
  };
};
