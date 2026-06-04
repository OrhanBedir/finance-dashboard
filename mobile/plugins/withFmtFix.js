const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Fixes fmt pod compilation error with Xcode 16+ / Clang 16+
 *
 * react_native_post_install forces CLANG_CXX_LANGUAGE_STANDARD=c++20 on ALL targets.
 * We must run our fix AFTER it, inside the same post_install block.
 * Strategy: find "  end\nend" at the very bottom and insert before the first "end".
 */
module.exports = function withFmtFix(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let podfile = fs.readFileSync(podfilePath, 'utf8');

      if (podfile.includes('fmt_xcode16_fix')) {
        return config;
      }

      // The fmt patch — runs after react_native_post_install, still inside post_install
      const fmtPatch = `
  # fmt_xcode16_fix: override c++20 forced by react_native_post_install
  installer.pods_project.targets.each do |target|
    next unless target.name == 'fmt'
    target.build_configurations.each do |cfg|
      cfg.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
      cfg.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = '$(inherited) FMT_USE_CONSTEVAL=0'
    end
  end
`;

      // The Podfile ends with:
      //   )        <- closes react_native_post_install args
      //   end      <- closes post_install do block
      // end        <- closes target do block
      //
      // We want to insert fmtPatch between the two trailing ends.
      // Pattern: "\n  end\nend" at end of file → "\n  [patch]\n  end\nend"
      const trailingPattern = '\n  end\nend';
      const idx = podfile.lastIndexOf(trailingPattern);

      if (idx !== -1) {
        podfile =
          podfile.slice(0, idx) +
          '\n' + fmtPatch +
          podfile.slice(idx);
      } else {
        // Fallback: wrap in a new post_install block
        podfile += `\npost_install do |installer|\n${fmtPatch}\nend\n`;
      }

      fs.writeFileSync(podfilePath, podfile);
      console.log('[withFmtFix] Applied fmt Xcode 16 fix after react_native_post_install');
      return config;
    },
  ]);
};
