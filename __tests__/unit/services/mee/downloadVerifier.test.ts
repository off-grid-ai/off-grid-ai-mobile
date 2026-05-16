/**
 * MEE Download Verifier — Unit Tests
 *
 * Tests file existence, size, and GGUF magic byte verification.
 */

import RNFS from 'react-native-fs';

jest.mock('react-native-fs', () => ({
  exists: jest.fn(),
  stat: jest.fn(),
  read: jest.fn(),
}));

jest.mock('../../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;

import { verifyDownloadIntegrity } from '../../../../src/services/mee/downloadVerifier';

describe('MEE DownloadVerifier', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns invalid if file does not exist', async () => {
    mockedRNFS.exists.mockResolvedValue(false);

    const result = await verifyDownloadIntegrity('/path/to/model.gguf');

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('does not exist');
  });

  it('returns invalid if file is empty', async () => {
    mockedRNFS.exists.mockResolvedValue(true);
    mockedRNFS.stat.mockResolvedValue({ size: 0 } as any);

    const result = await verifyDownloadIntegrity('/path/to/model.gguf');

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('empty');
  });

  it('returns valid when size matches expected', async () => {
    const expectedSize = 4_000_000_000;
    mockedRNFS.exists.mockResolvedValue(true);
    mockedRNFS.stat.mockResolvedValue({ size: expectedSize } as any);
    // GGUF magic: "GGUF" → base64 "R0dVRg=="
    mockedRNFS.read.mockResolvedValue(btoa('GGUF'));

    const result = await verifyDownloadIntegrity('/path/to/model.gguf', expectedSize);

    expect(result.valid).toBe(true);
    expect(result.fileSizeBytes).toBe(expectedSize);
  });

  it('returns invalid when size mismatches beyond tolerance', async () => {
    const expectedSize = 4_000_000_000;
    const actualSize = 3_800_000_000; // 200MB difference > 1% tolerance
    mockedRNFS.exists.mockResolvedValue(true);
    mockedRNFS.stat.mockResolvedValue({ size: actualSize } as any);
    mockedRNFS.read.mockResolvedValue(btoa('GGUF'));

    const result = await verifyDownloadIntegrity('/path/to/model.gguf', expectedSize);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Size mismatch');
  });

  it('passes when size is within 1% tolerance', async () => {
    const expectedSize = 4_000_000_000;
    const actualSize = 4_030_000_000; // within 1%
    mockedRNFS.exists.mockResolvedValue(true);
    mockedRNFS.stat.mockResolvedValue({ size: actualSize } as any);
    mockedRNFS.read.mockResolvedValue(btoa('GGUF'));

    const result = await verifyDownloadIntegrity('/path/to/model.gguf', expectedSize);

    expect(result.valid).toBe(true);
  });

  it('skips size check when expectedBytes is 0', async () => {
    mockedRNFS.exists.mockResolvedValue(true);
    mockedRNFS.stat.mockResolvedValue({ size: 1000 } as any);

    const result = await verifyDownloadIntegrity('/path/to/model.bin', 0);

    expect(result.valid).toBe(true);
  });

  it('checks GGUF magic bytes for .gguf files', async () => {
    mockedRNFS.exists.mockResolvedValue(true);
    mockedRNFS.stat.mockResolvedValue({ size: 4_000_000_000 } as any);
    // Invalid magic (not GGUF)
    mockedRNFS.read.mockResolvedValue(btoa('XXXX'));

    const result = await verifyDownloadIntegrity('/path/to/model.gguf');

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Invalid GGUF');
  });

  it('skips GGUF magic check for non-gguf files', async () => {
    mockedRNFS.exists.mockResolvedValue(true);
    mockedRNFS.stat.mockResolvedValue({ size: 1_000_000 } as any);

    const result = await verifyDownloadIntegrity('/path/to/model.onnx');

    expect(result.valid).toBe(true);
    // read should not be called for non-gguf
    expect(mockedRNFS.read).not.toHaveBeenCalled();
  });

  it('handles stat error gracefully', async () => {
    mockedRNFS.exists.mockResolvedValue(true);
    mockedRNFS.stat.mockRejectedValue(new Error('Permission denied'));

    const result = await verifyDownloadIntegrity('/path/to/model.gguf');

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Permission denied');
  });
});
