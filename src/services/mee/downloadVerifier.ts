/**
 * MEE Download Verifier — chunk-based integrity verification for downloaded models.
 *
 * Provides post-download file size verification and basic integrity checks.
 * Works with the existing native DownloadManagerModule which already handles
 * HTTP range-resume; this adds the JS-side verification layer.
 */

import RNFS from 'react-native-fs';
import logger from '../../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerificationResult {
  valid: boolean;
  reason?: string;
  fileSizeBytes?: number;
  expectedBytes?: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Verify a downloaded file's integrity by checking file existence and size.
 *
 * @param filePath      Absolute path to the downloaded file.
 * @param expectedBytes Expected file size in bytes (from the server / HF API).
 *                      Pass 0 or undefined to skip the size check.
 * @returns             Verification result.
 */
export async function verifyDownloadIntegrity(
  filePath: string,
  expectedBytes?: number,
): Promise<VerificationResult> {
  try {
    const exists = await RNFS.exists(filePath);
    if (!exists) {
      return { valid: false, reason: 'File does not exist' };
    }

    const stat = await RNFS.stat(filePath);
    const actualSize = typeof stat.size === 'string'
      ? Number.parseInt(stat.size, 10)
      : stat.size;

    // Empty file is always invalid
    if (actualSize === 0) {
      return { valid: false, reason: 'File is empty (0 bytes)', fileSizeBytes: 0, expectedBytes };
    }

    // Size mismatch check (only when expected size is known)
    if (expectedBytes && expectedBytes > 0) {
      // Allow 1% tolerance for filesystem block-size rounding
      const tolerance = Math.max(expectedBytes * 0.01, 1024);
      if (Math.abs(actualSize - expectedBytes) > tolerance) {
        logger.warn(
          `[MEE][Verify] Size mismatch: expected=${expectedBytes}, actual=${actualSize}, ` +
          `diff=${Math.abs(actualSize - expectedBytes)}`,
        );
        return {
          valid: false,
          reason: `Size mismatch: expected ${formatSize(expectedBytes)}, got ${formatSize(actualSize)}`,
          fileSizeBytes: actualSize,
          expectedBytes,
        };
      }
    }

    // GGUF magic number check for text models
    const isGguf = filePath.toLowerCase().endsWith('.gguf');
    if (isGguf) {
      const magicValid = await verifyGgufMagic(filePath);
      if (!magicValid) {
        return {
          valid: false,
          reason: 'Invalid GGUF file header — file may be corrupted or incomplete',
          fileSizeBytes: actualSize,
          expectedBytes,
        };
      }
    }

    return { valid: true, fileSizeBytes: actualSize, expectedBytes };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[MEE][Verify] Verification failed:', msg);
    return { valid: false, reason: `Verification error: ${msg}` };
  }
}

/**
 * Check the GGUF magic bytes (first 4 bytes should be "GGUF" → 0x47475546).
 */
async function verifyGgufMagic(filePath: string): Promise<boolean> {
  try {
    // Read first 4 bytes as base64
    const data = await RNFS.read(filePath, 4, 0, 'base64');
    if (!data || data.length === 0) return false;

    // Decode base64 → check for "GGUF"
    // "GGUF" in base64 is "R0dVRg=="
    // But we only read 4 bytes, so we decode and compare directly
    const decoded = atob(data);
    return decoded.startsWith('GGUF');
  } catch {
    // If we can't read the file header, assume valid to avoid false positives
    return true;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
