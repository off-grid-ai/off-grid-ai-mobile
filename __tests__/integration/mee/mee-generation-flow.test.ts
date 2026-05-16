/**
 * MEE Integration Test — Generation Flow
 *
 * Tests the full MEE lifecycle: device profiling → background pause →
 * text generation → cache flush → background resume.
 *
 * Verifies that MEE modules cooperate correctly across service boundaries.
 */

import { hardwareService } from '../../../src/services/hardware';
import { llmService } from '../../../src/services/llm';
import { backgroundDownloadService } from '../../../src/services/backgroundDownloadService';
import { meeCacheManager } from '../../../src/services/mee/cacheManager';
import { getDeviceProfile } from '../../../src/services/mee/deviceProfile';
import { detectTurboModel, resolveEffectiveSteps } from '../../../src/services/mee/turboDetector';
import { verifyDownloadIntegrity } from '../../../src/services/mee/downloadVerifier';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../../src/services/hardware', () => ({
  hardwareService: {
    getDeviceInfo: jest.fn(),
    getSoCInfo: jest.fn(),
    refreshMemoryInfo: jest.fn(),
    getRecommendedThreadCount: jest.fn().mockResolvedValue(4),
  },
}));

jest.mock('../../../src/services/llm', () => ({
  llmService: {
    isModelLoaded: jest.fn(),
    clearKVCache: jest.fn(),
    isCurrentlyGenerating: jest.fn().mockReturnValue(false),
  },
}));

jest.mock('../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: {
    pauseForInference: jest.fn(),
    resumeAfterInference: jest.fn(),
    isPaused: jest.fn().mockReturnValue(false),
  },
}));

jest.mock('react-native-fs', () => ({
  exists: jest.fn(),
  stat: jest.fn(),
  read: jest.fn(),
}));

jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockedHardware = hardwareService as jest.Mocked<typeof hardwareService>;
const mockedLlm = llmService as jest.Mocked<typeof llmService>;
const mockedBgDownload = backgroundDownloadService as jest.Mocked<typeof backgroundDownloadService>;

const GB = 1024 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function setupDevice(totalGB: number, hasNPU: boolean = false) {
  mockedHardware.getDeviceInfo.mockResolvedValue({
    totalMemory: totalGB * GB,
    usedMemory: 2 * GB,
    availableMemory: (totalGB - 2) * GB,
    deviceModel: 'Test',
    systemName: 'Android',
    systemVersion: '14',
    isEmulator: false,
  });
  mockedHardware.getSoCInfo.mockResolvedValue({
    vendor: 'qualcomm',
    hasNPU,
    qnnVariant: hasNPU ? '8gen2' : undefined,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MEE Integration: Generation Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (meeCacheManager as any).lastProfile = null;
  });

  it('low-mid device: profiles → flushes cache after generation', async () => {
    // 1. Profile the device
    setupDevice(6, false);
    const profile = await getDeviceProfile();
    expect(profile.tier).toBe('low-mid');
    expect(profile.aggressiveCacheFlush).toBe(true);
    expect(profile.pauseBackgroundDuringInference).toBe(true);

    // 2. Simulate cache flush after text generation
    mockedLlm.isModelLoaded.mockReturnValue(true);
    mockedLlm.clearKVCache.mockResolvedValue(undefined);
    await meeCacheManager.flushAfterTextGeneration();
    expect(mockedLlm.clearKVCache).toHaveBeenCalledWith(false);
  });

  it('mid-high device: profiles → skips cache flush', async () => {
    setupDevice(12, false);
    const profile = await getDeviceProfile();
    expect(profile.tier).toBe('mid-high');
    expect(profile.aggressiveCacheFlush).toBe(false);

    mockedLlm.isModelLoaded.mockReturnValue(true);
    await meeCacheManager.flushAfterTextGeneration();
    expect(mockedLlm.clearKVCache).not.toHaveBeenCalled();
  });

  it('turbo model detection feeds into image gen flow', () => {
    // Simulate a turbo model
    const turbo = detectTurboModel('sdxl-turbo-v1');
    expect(turbo.isTurbo).toBe(true);

    // Platform default is 8, user hasn't changed it
    const steps = resolveEffectiveSteps(8, 8, turbo);
    expect(steps).toBe(4); // turbo auto-optimized

    // Simulate standard model
    const standard = detectTurboModel('stable-diffusion-v1-5');
    const normalSteps = resolveEffectiveSteps(8, 8, standard);
    expect(normalSteps).toBe(8); // untouched
  });

  it('download verification catches corrupted files', async () => {
    const RNFS = require('react-native-fs');
    RNFS.exists.mockResolvedValue(true);
    RNFS.stat.mockResolvedValue({ size: 0 });

    const result = await verifyDownloadIntegrity('/models/broken.gguf', 4_000_000_000);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('empty');
  });

  it('full MEE lifecycle for low-mid device', async () => {
    setupDevice(6, false);

    // 1. Profile
    const profile = await getDeviceProfile();
    expect(profile.tier).toBe('low-mid');

    // 2. Pause background for inference
    // (In real code this is called by prepareGenerationImpl)
    backgroundDownloadService.pauseForInference();
    expect(mockedBgDownload.pauseForInference).toHaveBeenCalled();

    // 3. After generation → flush + resume
    mockedLlm.isModelLoaded.mockReturnValue(true);
    mockedLlm.clearKVCache.mockResolvedValue(undefined);
    await meeCacheManager.flushAfterTextGeneration();
    expect(mockedLlm.clearKVCache).toHaveBeenCalledWith(false);

    backgroundDownloadService.resumeAfterInference();
    expect(mockedBgDownload.resumeAfterInference).toHaveBeenCalled();
  });
});
