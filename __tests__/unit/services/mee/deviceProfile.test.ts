/**
 * MEE Device Profile — Unit Tests
 *
 * Tests device tier classification, quantization recommendations,
 * and GPU layer capping based on RAM + NPU state.
 */

import { hardwareService } from '../../../../src/services/hardware';

// We test the module functions directly — mock hardwareService
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

const mockedHardware = hardwareService as jest.Mocked<typeof hardwareService>;

import { getDeviceProfile } from '../../../../src/services/mee/deviceProfile';

const GB = 1024 * 1024 * 1024;

function setupDevice(totalGB: number, usedGB: number, vendor: string = 'qualcomm', hasNPU: boolean = false) {
  mockedHardware.getDeviceInfo.mockResolvedValue({
    totalMemory: totalGB * GB,
    usedMemory: usedGB * GB,
    availableMemory: (totalGB - usedGB) * GB,
    deviceModel: 'Test',
    systemName: 'Android',
    systemVersion: '14',
    isEmulator: false,
  });
  mockedHardware.getSoCInfo.mockResolvedValue({
    vendor: vendor as any,
    hasNPU,
    qnnVariant: hasNPU ? '8gen2' : undefined,
  });
}

describe('MEE DeviceProfile', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('tier classification', () => {
    it('classifies 3GB device as low-mid', async () => {
      setupDevice(3, 1);
      const profile = await getDeviceProfile();
      expect(profile.tier).toBe('low-mid');
    });

    it('classifies 6GB device as low-mid', async () => {
      setupDevice(6, 2);
      const profile = await getDeviceProfile();
      expect(profile.tier).toBe('low-mid');
    });

    it('classifies 8GB device without NPU as low-mid', async () => {
      setupDevice(8, 3, 'qualcomm', false);
      const profile = await getDeviceProfile();
      expect(profile.tier).toBe('low-mid');
    });

    it('classifies 8GB device with NPU as mid-high', async () => {
      setupDevice(8, 3, 'qualcomm', true);
      const profile = await getDeviceProfile();
      expect(profile.tier).toBe('mid-high');
    });

    it('classifies 12GB device as mid-high regardless of NPU', async () => {
      setupDevice(12, 4, 'qualcomm', false);
      const profile = await getDeviceProfile();
      expect(profile.tier).toBe('mid-high');
    });

    it('classifies 16GB device as mid-high', async () => {
      setupDevice(16, 4);
      const profile = await getDeviceProfile();
      expect(profile.tier).toBe('mid-high');
    });
  });

  describe('quantization recommendations', () => {
    it('recommends 3-bit for sub-4GB devices', async () => {
      setupDevice(3, 1);
      const profile = await getDeviceProfile();
      expect(profile.recommendedQuantization).toBe('3-bit');
    });

    it('recommends 4-bit for 6GB low-mid device', async () => {
      setupDevice(6, 2);
      const profile = await getDeviceProfile();
      expect(profile.recommendedQuantization).toBe('4-bit');
    });

    it('recommends 8-bit for 12GB mid-high device', async () => {
      setupDevice(12, 4, 'qualcomm', false);
      const profile = await getDeviceProfile();
      expect(profile.recommendedQuantization).toBe('8-bit');
    });

    it('recommends fp16 for 16GB+ mid-high device', async () => {
      setupDevice(16, 4, 'qualcomm', true);
      const profile = await getDeviceProfile();
      expect(profile.recommendedQuantization).toBe('fp16');
    });
  });

  describe('GPU layer recommendations', () => {
    it('caps GPU layers to 0 for sub-4GB devices', async () => {
      setupDevice(3, 1);
      const profile = await getDeviceProfile();
      expect(profile.maxGpuLayers).toBe(0);
    });

    it('allows 8 GPU layers for 6GB low-mid without NPU', async () => {
      setupDevice(6, 2, 'qualcomm', false);
      const profile = await getDeviceProfile();
      expect(profile.maxGpuLayers).toBe(8);
    });

    it('allows 12 GPU layers for low-mid with NPU', async () => {
      setupDevice(6, 2, 'qualcomm', true);
      const profile = await getDeviceProfile();
      expect(profile.maxGpuLayers).toBe(12);
    });

    it('allows 99 GPU layers for mid-high', async () => {
      setupDevice(12, 4, 'qualcomm', false);
      const profile = await getDeviceProfile();
      expect(profile.maxGpuLayers).toBe(99);
    });
  });

  describe('adaptive flags', () => {
    it('enables aggressive cache flush for low-mid', async () => {
      setupDevice(6, 2);
      const profile = await getDeviceProfile();
      expect(profile.aggressiveCacheFlush).toBe(true);
      expect(profile.pauseBackgroundDuringInference).toBe(true);
      expect(profile.parallelProcessingEnabled).toBe(false);
    });

    it('disables aggressive cache flush for mid-high', async () => {
      setupDevice(12, 4, 'qualcomm', false);
      const profile = await getDeviceProfile();
      expect(profile.aggressiveCacheFlush).toBe(false);
      expect(profile.pauseBackgroundDuringInference).toBe(false);
      expect(profile.parallelProcessingEnabled).toBe(true);
    });
  });

  describe('GPU family detection', () => {
    it.each([
      ['qualcomm', 'Adreno'],
      ['apple', 'Metal'],
      ['mediatek', 'Mali'],
      ['exynos', 'Mali'],
      ['tensor', 'Mali'],
      ['unknown', 'Unknown'],
    ])('maps %s to %s', async (vendor, expected) => {
      setupDevice(8, 3, vendor, false);
      const profile = await getDeviceProfile();
      expect(profile.gpuFamily).toBe(expected);
    });
  });
});
