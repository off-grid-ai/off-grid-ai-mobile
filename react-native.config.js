const fs = require('fs');
const path = require('path');

// Autolink the pro submodule's native library ONLY when it is actually on
// disk. Mirrors the fs.existsSync(pro) guard metro.config.js uses for the pro
// JS: a public clone without the private submodule sees an empty/absent pro/
// dir, this entry is omitted, and the open build compiles with no pro native.
//
// IMPORTANT: check a real file inside pro/, never just the pro/ directory - an
// uninitialised submodule leaves an empty pro/ folder behind.
const proRoot = path.resolve(__dirname, 'pro');
const proAndroidGradle = path.join(proRoot, 'android', 'build.gradle');
const proPodspec = path.join(proRoot, 'ios', 'OffgridPro.podspec');
const proHasNative = fs.existsSync(proAndroidGradle);

module.exports = {
  dependencies: {
    ...(proHasNative
      ? {
          '@offgrid/pro': {
            root: proRoot,
            platforms: {
              android: {
                sourceDir: path.join(proRoot, 'android'),
                packageImportPath: 'import ai.offgridmobile.alwayson.AlwaysOnTranscriptionPackage;',
                packageInstance: 'new AlwaysOnTranscriptionPackage()',
              },
              ios: {
                podspecPath: proPodspec,
              },
            },
          },
        }
      : {}),
  },
};
