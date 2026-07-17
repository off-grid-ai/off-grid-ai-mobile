import { Platform } from 'react-native';
import logger from '../../utils/logger';
import { hardwareService } from '../hardware';
import { checkOverrideSurvival, LoadPolicy } from '../memoryBudget';
import {
  formatOverrideAdmittedLine,
  formatOverrideRefusedLine,
} from './logging';
import { ResidentSpec } from './residents';

/** Read the live post-eviction RAM boundary and apply the owned survival rule. */
export async function overridePassesSurvivalFloor(args: {
  spec: ResidentSpec;
  totalRamMB: number;
  policy: LoadPolicy;
  evict: Array<{ key: string }>;
}): Promise<boolean> {
  const { spec, totalRamMB, policy, evict } = args;
  await hardwareService.refreshMemoryInfo().catch(() => {});
  const survival = checkOverrideSurvival({
    realAvailableMB: Math.round(hardwareService.getAvailableMemoryGB() * 1024),
    totalRamMB,
    incomingDirtyMB: spec.dirtyMemory ? spec.sizeMB : 0,
    platform: Platform.OS,
    policy,
  });
  logger.log(
    survival.fits
      ? formatOverrideAdmittedLine({ specKey: spec.key, evict, ...survival })
      : formatOverrideRefusedLine({ specKey: spec.key, ...survival }),
  );
  return survival.fits;
}
