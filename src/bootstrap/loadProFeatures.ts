import { registerToolExtension } from '../services/tools/extensions';
import { registerScreen } from '../navigation/screenRegistry';
import { registerSettingsSection } from '../components/settings/sectionRegistry';

export async function loadProFeatures(): Promise<void> {
  let pro: any;
  try {
    pro = require('@offgrid/pro');
  } catch {
    return; // free / contributor build: package not installed
  }
  if (!pro) {
    return; // proStub.js returns null — free build via metro extraNodeModules
  }

  // Run synchronously before any await so screens are registered before the
  // navigator renders (App.tsx doesn't await loadProFeatures).
  pro.activate({ registerToolExtension, registerScreen, registerSettingsSection });
}
