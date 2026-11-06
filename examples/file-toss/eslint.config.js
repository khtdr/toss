const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', 'android/*', '.expo/*'] },
  // This guards against HTML entities, which don't exist in React Native's Text.
  { rules: { 'react/no-unescaped-entities': 'off' } },
]);
