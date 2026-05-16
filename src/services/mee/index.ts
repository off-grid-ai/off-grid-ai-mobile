/**
 * MEE — Multimodal Efficiency Engine
 *
 * Central barrel export for all MEE sub-modules.
 */

export { getDeviceProfile } from './deviceProfile';
export type { MEEDeviceTier, MEEQuantizationHint, MEEDeviceProfile } from './deviceProfile';

export { meeCacheManager } from './cacheManager';

export { detectTurboModel, resolveEffectiveSteps } from './turboDetector';
export type { TurboModelConfig } from './turboDetector';

export { verifyDownloadIntegrity } from './downloadVerifier';
export type { VerificationResult } from './downloadVerifier';
