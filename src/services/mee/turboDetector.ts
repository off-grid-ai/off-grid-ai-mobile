/**
 * MEE Turbo Model Detector — identifies Turbo / Lightning / LCM image models
 * that require fewer diffusion steps (4–8 vs 20+) while maintaining quality.
 *
 * When a turbo model is detected, the recommended step count and guidance
 * scale are returned so the caller can override user defaults without
 * sacrificing output quality.
 */

import logger from '../../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TurboModelConfig {
  /** Is this a turbo/lightning/LCM model? */
  isTurbo: boolean;
  /** Recommended number of diffusion steps */
  recommendedSteps: number;
  /** Recommended CFG / guidance scale */
  recommendedGuidanceScale: number;
  /** Human-readable label for UI */
  label: string;
}

// ---------------------------------------------------------------------------
// Detection patterns (case-insensitive)
// ---------------------------------------------------------------------------

interface TurboPattern {
  pattern: RegExp;
  steps: number;
  guidance: number;
  label: string;
}

const TURBO_PATTERNS: TurboPattern[] = [
  // SDXL Turbo
  { pattern: /turbo/i, steps: 4, guidance: 0.0, label: 'Turbo' },
  // Lightning models (ByteDance)
  { pattern: /lightning/i, steps: 4, guidance: 1.0, label: 'Lightning' },
  // Latent Consistency Models
  { pattern: /\blcm\b/i, steps: 4, guidance: 1.0, label: 'LCM' },
  // Hyper models
  { pattern: /\bhyper\b/i, steps: 4, guidance: 0.0, label: 'Hyper' },
  // DMD2 (distribution matching distillation)
  { pattern: /\bdmd2?\b/i, steps: 4, guidance: 1.0, label: 'DMD' },
];

// ---------------------------------------------------------------------------
// Default (non-turbo) config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: TurboModelConfig = {
  isTurbo: false,
  recommendedSteps: 8,
  recommendedGuidanceScale: 7.5,
  label: 'Standard',
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Detect whether an image model is a turbo/lightning variant from its
 * name or directory path.
 *
 * @param modelNameOrPath  The model name, id, or file path to inspect.
 * @returns  A config object with recommended steps + guidance scale.
 */
export function detectTurboModel(modelNameOrPath: string): TurboModelConfig {
  if (!modelNameOrPath) return DEFAULT_CONFIG;

  for (const { pattern, steps, guidance, label } of TURBO_PATTERNS) {
    if (pattern.test(modelNameOrPath)) {
      logger.log(
        `[MEE][Turbo] Detected ${label} model: "${modelNameOrPath}" → steps=${steps}, guidance=${guidance}`,
      );
      return {
        isTurbo: true,
        recommendedSteps: steps,
        recommendedGuidanceScale: guidance,
        label,
      };
    }
  }

  return DEFAULT_CONFIG;
}

/**
 * Given user-chosen steps and a turbo config, return the effective steps.
 * If the model is turbo and the user hasn't explicitly customised steps
 * (i.e. they're still at the platform default), prefer the turbo recommendation.
 */
export function resolveEffectiveSteps(
  userSteps: number,
  platformDefault: number,
  turboConfig: TurboModelConfig,
): number {
  if (!turboConfig.isTurbo) return userSteps;
  // If the user explicitly changed steps away from the platform default,
  // respect their choice even on turbo models.
  if (userSteps !== platformDefault) return userSteps;
  return turboConfig.recommendedSteps;
}
