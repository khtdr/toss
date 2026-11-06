const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

// This app isn't a workspace, so React Native stays out of the root install.
// toss-core and toss-qr are linked from packages/, with their dependencies in
// the root node_modules.
const root = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);

config.watchFolders = [path.join(root, 'packages'), path.join(root, 'node_modules')];
config.resolver.nodeModulesPaths = [
  path.join(__dirname, 'node_modules'),
  path.join(root, 'node_modules'),
];

module.exports = config;
