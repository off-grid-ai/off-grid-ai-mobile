/**
 * MEE Turbo Detector — Unit Tests
 *
 * Tests turbo/lightning/LCM model detection and effective step resolution.
 */

import { detectTurboModel, resolveEffectiveSteps } from '../../../../src/services/mee/turboDetector';

jest.mock('../../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('MEE TurboDetector', () => {
  describe('detectTurboModel', () => {
    it('detects SDXL Turbo model', () => {
      const config = detectTurboModel('sdxl-turbo-v1');
      expect(config.isTurbo).toBe(true);
      expect(config.label).toBe('Turbo');
      expect(config.recommendedSteps).toBe(4);
      expect(config.recommendedGuidanceScale).toBe(0.0);
    });

    it('detects Lightning model', () => {
      const config = detectTurboModel('sd-lightning-4step');
      expect(config.isTurbo).toBe(true);
      expect(config.label).toBe('Lightning');
      expect(config.recommendedSteps).toBe(4);
    });

    it('detects LCM model', () => {
      const config = detectTurboModel('stable-diffusion-lcm-v1');
      expect(config.isTurbo).toBe(true);
      expect(config.label).toBe('LCM');
    });

    it('detects Hyper model', () => {
      const config = detectTurboModel('sdxl-hyper-8step');
      expect(config.isTurbo).toBe(true);
      expect(config.label).toBe('Hyper');
    });

    it('detects DMD model', () => {
      const config = detectTurboModel('sd-dmd2-model');
      expect(config.isTurbo).toBe(true);
      expect(config.label).toBe('DMD');
    });

    it('returns standard for non-turbo model', () => {
      const config = detectTurboModel('stable-diffusion-v1-5');
      expect(config.isTurbo).toBe(false);
      expect(config.label).toBe('Standard');
      expect(config.recommendedSteps).toBe(8);
    });

    it('handles empty string', () => {
      const config = detectTurboModel('');
      expect(config.isTurbo).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(detectTurboModel('SDXL-TURBO').isTurbo).toBe(true);
      expect(detectTurboModel('SD-Lightning-4step').isTurbo).toBe(true);
      expect(detectTurboModel('stable-diffusion-LCM').isTurbo).toBe(true);
    });

    it('detects turbo from file path', () => {
      const config = detectTurboModel('/models/sdxl-turbo/model.onnx');
      expect(config.isTurbo).toBe(true);
    });
  });

  describe('resolveEffectiveSteps', () => {
    const turboConfig = { isTurbo: true, recommendedSteps: 4, recommendedGuidanceScale: 0, label: 'Turbo' };
    const standardConfig = { isTurbo: false, recommendedSteps: 8, recommendedGuidanceScale: 7.5, label: 'Standard' };
    const platformDefault = 8;

    it('uses turbo steps when user has platform default', () => {
      const steps = resolveEffectiveSteps(8, platformDefault, turboConfig);
      expect(steps).toBe(4); // turbo override
    });

    it('respects user custom steps even for turbo model', () => {
      const steps = resolveEffectiveSteps(12, platformDefault, turboConfig);
      expect(steps).toBe(12); // user chose 12 explicitly
    });

    it('passes through user steps for standard model', () => {
      const steps = resolveEffectiveSteps(20, platformDefault, standardConfig);
      expect(steps).toBe(20);
    });

    it('passes through default steps for standard model', () => {
      const steps = resolveEffectiveSteps(8, platformDefault, standardConfig);
      expect(steps).toBe(8);
    });
  });
});
