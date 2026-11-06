// CommonJS because Expo loads config plugins with require, and this package is ESM.
const { AndroidConfig, createRunOncePlugin, withPlugins } = require('expo/config-plugins');
const pkg = require('./package.json');

const CAMERA_USAGE = "Allow $(PRODUCT_NAME) to use the camera to read codes from another phone's screen";

/**
 * Sets up the permissions toss needs and leaves out the ones it doesn't: scanning
 * never records audio, and full brightness only changes this app's window, so the
 * WRITE_SETTINGS that expo-brightness declares goes unused.
 *
 * @param {import('expo/config-plugins').ExportedConfig} config
 * @param {{ cameraPermission?: string }} [options] `cameraPermission` is the iOS prompt.
 */
function withToss(config, { cameraPermission = CAMERA_USAGE } = {}) {
  config = withPlugins(config, [
    [
      'expo-camera',
      { cameraPermission, microphonePermission: false, recordAudioAndroid: false },
    ],
  ]);
  return AndroidConfig.Permissions.withBlockedPermissions(config, [
    'android.permission.WRITE_SETTINGS',
  ]);
}

module.exports = createRunOncePlugin(withToss, pkg.name, pkg.version);
