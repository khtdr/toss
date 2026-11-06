const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

// This app isn't a workspace. Its packages are linked from packages/, with their
// dependencies in the root node_modules. The root also holds React and React
// Native, for toss-react-native's types and tests, so anything linked must not
// find those by walking up: a second React breaks every hook at runtime. Looking
// only in these two folders, in this order, keeps one copy. It also hides
// anything nested in a package's own node_modules, so those must be direct dependencies.
const root = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);

config.watchFolders = [path.join(root, 'packages'), path.join(root, 'node_modules')];
config.resolver.nodeModulesPaths = [
  path.join(__dirname, 'node_modules'),
  path.join(root, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
