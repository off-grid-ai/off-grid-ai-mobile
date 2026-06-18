import { registerToolExtension } from '../services/tools/extensions';
import { registerScreen } from '../navigation/screenRegistry';
import { registerSettingsSection } from '../components/settings/sectionRegistry';
import { readProFromKeychain } from '../services/proLicenseService';

export async function loadProFeatures(isPro?: boolean): Promise<void> {
  let pro: any;
  try {
    pro = require('@offgrid/pro');
  } catch {
    return; // free / contributor build: package not installed
  }
  if (!pro) {
    return; // proStub.js returns null — free build via metro extraNodeModules
  }

  // The boot path already read the entitlement in checkProStatus(); reuse it to
  // avoid a second keychain round-trip. Fall back to a read for standalone callers.
  const active = isPro ?? (await readProFromKeychain());
  if (!active) {
    return; // paid features stay dormant until the user purchases
  }

  pro.activate({ registerToolExtension, registerScreen, registerSettingsSection });
}
