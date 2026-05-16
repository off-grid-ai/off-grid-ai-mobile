/**
 * MEE Cache Manager — Unit Tests
 *
 * Tests that the cache manager flushes KV cache based on device tier.
 */

import { llmService } from '../../../../src/services/llm';

jest.mock('../../../../src/services/llm', () => ({
  llmService: {
    isModelLoaded: jest.fn(),
    clearKVCache: jest.fn(),
  },
}));

jest.mock('../../../../src/services/hardware', () => ({
  hardwareService: {
    getDeviceInfo: jest.fn(),
    getSoCInfo: jest.fn(),
  },
}));

jest.mock('../../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { hardwareService } = require('../../../../src/services/hardware');
const mockedLlm = llmService as jest.Mocked<typeof llmService>;
const GB = 1024 * 1024 * 1024;

import { meeCacheManager } from '../../../../src/services/mee/cacheManager';

function setupLowMidDevice() {
  hardwareService.getDeviceInfo.mockResolvedValue({
    totalMemory: 6 * GB,
    usedMemory: 2 * GB,
    availableMemory: 4 * GB,
    deviceModel: 'Test',
    systemName: 'Android',
    systemVersion: '14',
    isEmulator: false,
  });
  hardwareService.getSoCInfo.mockResolvedValue({
    vendor: 'qualcomm',
    hasNPU: false,
  });
}

function setupMidHighDevice() {
  hardwareService.getDeviceInfo.mockResolvedValue({
    totalMemory: 12 * GB,
    usedMemory: 4 * GB,
    availableMemory: 8 * GB,
    deviceModel: 'Test',
    systemName: 'Android',
    systemVersion: '14',
    isEmulator: false,
  });
  hardwareService.getSoCInfo.mockResolvedValue({
    vendor: 'qualcomm',
    hasNPU: false,
  });
}

describe('MEE CacheManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset internal cached profile
    (meeCacheManager as any).lastProfile = null;
  });

  describe('flushAfterTextGeneration', () => {
    it('flushes KV cache on low-mid device', async () => {
      setupLowMidDevice();
      mockedLlm.isModelLoaded.mockReturnValue(true);
      mockedLlm.clearKVCache.mockResolvedValue(undefined);

      await meeCacheManager.flushAfterTextGeneration();

      expect(mockedLlm.clearKVCache).toHaveBeenCalledWith(false);
    });

    it('does not flush on mid-high device with plenty of RAM', async () => {
      setupMidHighDevice();
      mockedLlm.isModelLoaded.mockReturnValue(true);

      await meeCacheManager.flushAfterTextGeneration();

      expect(mockedLlm.clearKVCache).not.toHaveBeenCalled();
    });

    it('skips flush if no model is loaded', async () => {
      setupLowMidDevice();
      mockedLlm.isModelLoaded.mockReturnValue(false);

      await meeCacheManager.flushAfterTextGeneration();

      expect(mockedLlm.clearKVCache).not.toHaveBeenCalled();
    });
  });

  describe('flushAfterImageGeneration', () => {
    it('flushes on low-mid device', async () => {
      setupLowMidDevice();
      mockedLlm.isModelLoaded.mockReturnValue(true);
      mockedLlm.clearKVCache.mockResolvedValue(undefined);

      await meeCacheManager.flushAfterImageGeneration();

      expect(mockedLlm.clearKVCache).toHaveBeenCalledWith(false);
    });

    it('does not flush on mid-high device', async () => {
      setupMidHighDevice();

      await meeCacheManager.flushAfterImageGeneration();

      expect(mockedLlm.clearKVCache).not.toHaveBeenCalled();
    });
  });

  describe('forceFlush', () => {
    it('always flushes when called', async () => {
      setupMidHighDevice();
      mockedLlm.isModelLoaded.mockReturnValue(true);
      mockedLlm.clearKVCache.mockResolvedValue(undefined);

      await meeCacheManager.forceFlush();

      expect(mockedLlm.clearKVCache).toHaveBeenCalledWith(false);
    });
  });
});
