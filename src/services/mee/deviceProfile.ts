/**
 * MEE Device Profile — Resource-adaptive execution core.
 *
 * Classifies the device into a MEE tier (low-mid / mid-high) and produces
 * an execution profile that other MEE modules consume:
 *  - recommended quantization
 *  - max GPU layers
 *  - whether parallel multimodal tasks are safe
 *  - whether aggressive cache flushing is needed
 */

import { hardwareService } from '../hardware';
import type { SoCVendor } from '../../types';
import logger from '../../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MEEDeviceTier = 'low-mid' | 'mid-high';

export type MEEQuantizationHint = '3-bit' | '4-bit' | '8-bit' | 'fp16';

export interface MEEDeviceProfile {
  /** Coarse device bucket */
  tier: MEEDeviceTier;
  /** Total physical RAM in GB */
  totalRamGB: number;
  /** RAM available right now in GB */
  availableRamGB: number;
  /** SoC vendor detected by hardwareService */
  socVendor: SoCVendor;
  /** Whether the device has an NPU (Qualcomm QNN / Apple Neural Engine) */
  hasNPU: boolean;
  /** GPU family string for logging (e.g. "Adreno", "Mali", "Metal") */
  gpuFamily: string;
  /** Suggested quantization level for text models */
  recommendedQuantization: MEEQuantizationHint;
  /** Suggested maximum GPU/NPU layers to offload */
  maxGpuLayers: number;
  /** Safe to run text + image generation concurrently? */
  parallelProcessingEnabled: boolean;
  /** Should we aggressively flush caches after each generation? */
  aggressiveCacheFlush: boolean;
  /** Should background processes be paused during inference? */
  pauseBackgroundDuringInference: boolean;
}

// ---------------------------------------------------------------------------
// Tier thresholds
// ---------------------------------------------------------------------------

const LOW_MID_RAM_CEILING_GB = 8;
const MID_HIGH_RAM_FLOOR_GB = 12;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function resolveGpuFamily(socVendor: SoCVendor): string {
  switch (socVendor) {
    case 'qualcomm': return 'Adreno';
    case 'apple': return 'Metal';
    case 'mediatek': return 'Mali';
    case 'exynos': return 'Mali';
    case 'tensor': return 'Mali';
    default: return 'Unknown';
  }
}

function resolveQuantization(
  tier: MEEDeviceTier,
  totalRamGB: number,
  hasNPU: boolean,
): MEEQuantizationHint {
  if (tier === 'mid-high') {
    // Mid-high devices can handle higher precision
    return totalRamGB >= 16 ? 'fp16' : '8-bit';
  }
  // Low-mid: conserve memory
  if (totalRamGB < 4) return '3-bit';
  if (hasNPU) return '4-bit'; // NPU can accelerate 4-bit well
  return '4-bit';
}

function resolveMaxGpuLayers(
  tier: MEEDeviceTier,
  totalRamGB: number,
  hasNPU: boolean,
): number {
  if (tier === 'mid-high') return 99; // let the LLM service cap it
  if (totalRamGB < 4) return 0;
  if (hasNPU) return 12;
  return 8;
}

/**
 * Build a device profile from the current hardware state.
 * Safe to call multiple times — results are NOT cached internally so they
 * reflect the latest refreshMemoryInfo() snapshot.
 */
export async function getDeviceProfile(): Promise<MEEDeviceProfile> {
  const deviceInfo = await hardwareService.getDeviceInfo();
  const socInfo = await hardwareService.getSoCInfo();

  const totalRamGB = deviceInfo.totalMemory / (1024 * 1024 * 1024);
  const availableRamGB = deviceInfo.availableMemory / (1024 * 1024 * 1024);

  // Tier classification:
  //  < 8 GB  → low-mid
  //  8–12 GB → depends on NPU (NPU → mid-high, else low-mid)
  //  ≥ 12 GB → mid-high
  let tier: MEEDeviceTier;
  if (totalRamGB >= MID_HIGH_RAM_FLOOR_GB) {
    tier = 'mid-high';
  } else if (totalRamGB >= LOW_MID_RAM_CEILING_GB && socInfo.hasNPU) {
    tier = 'mid-high';
  } else {
    tier = 'low-mid';
  }

  const hasNPU = socInfo.hasNPU;
  const gpuFamily = resolveGpuFamily(socInfo.vendor);
  const recommendedQuantization = resolveQuantization(tier, totalRamGB, hasNPU);
  const maxGpuLayers = resolveMaxGpuLayers(tier, totalRamGB, hasNPU);

  const profile: MEEDeviceProfile = {
    tier,
    totalRamGB,
    availableRamGB,
    socVendor: socInfo.vendor,
    hasNPU,
    gpuFamily,
    recommendedQuantization,
    maxGpuLayers,
    parallelProcessingEnabled: tier === 'mid-high',
    aggressiveCacheFlush: tier === 'low-mid',
    pauseBackgroundDuringInference: tier === 'low-mid',
  };

  logger.log(
    `[MEE] Device profile: tier=${profile.tier}, RAM=${totalRamGB.toFixed(1)}GB, ` +
    `NPU=${hasNPU}, quant=${recommendedQuantization}, gpuLayers=${maxGpuLayers}`,
  );

  return profile;
}
