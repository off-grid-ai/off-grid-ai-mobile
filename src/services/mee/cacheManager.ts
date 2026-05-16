/**
 * MEE Cache Manager — automatic post-generation cache flushing.
 *
 * On low-mid devices, KV cache and intermediate buffers are flushed
 * immediately after output is rendered. On mid-high devices the cache
 * is preserved to speed up follow-up generations in the same conversation.
 */

import { llmService } from '../llm';
import { getDeviceProfile, type MEEDeviceProfile } from './deviceProfile';
import logger from '../../utils/logger';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** RAM % threshold — if available RAM drops below this after generation, force flush. */
const CRITICAL_MEMORY_PERCENT = 0.25;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class MEECacheManager {
  private lastProfile: MEEDeviceProfile | null = null;

  /**
   * Call after every text generation completes (stream finished, message saved).
   * On low-mid devices this clears the KV cache to free VRAM/RAM immediately.
   */
  async flushAfterTextGeneration(): Promise<void> {
    const profile = await this.getProfile();

    if (profile.aggressiveCacheFlush) {
      await this.doFlush('post-text-generation (aggressive)');
      return;
    }

    // Mid-high: only flush if memory is critically low
    if (profile.availableRamGB / profile.totalRamGB < CRITICAL_MEMORY_PERCENT) {
      await this.doFlush('post-text-generation (critical memory)');
    }
  }

  /**
   * Call after every image generation completes.
   * Image gen already unloads its pipeline on low-RAM devices via
   * activeModelService, so this covers the LLM KV cache side.
   */
  async flushAfterImageGeneration(): Promise<void> {
    const profile = await this.getProfile();

    if (profile.aggressiveCacheFlush) {
      await this.doFlush('post-image-generation (aggressive)');
    }
  }

  /**
   * Force flush — used by the manual kill-switch or before heavy multimodal work.
   */
  async forceFlush(): Promise<void> {
    await this.doFlush('manual');
  }

  /** Refresh the cached profile (call after refreshMemoryInfo). */
  async refreshProfile(): Promise<MEEDeviceProfile> {
    this.lastProfile = null;
    return this.getProfile();
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private async getProfile(): Promise<MEEDeviceProfile> {
    if (!this.lastProfile) {
      this.lastProfile = await getDeviceProfile();
    }
    return this.lastProfile;
  }

  private async doFlush(reason: string): Promise<void> {
    if (!llmService.isModelLoaded()) return;
    try {
      await llmService.clearKVCache(false);
      logger.log(`[MEE][Cache] KV cache flushed (${reason})`);
    } catch (e) {
      logger.warn('[MEE][Cache] Flush failed:', e);
    }
  }
}

export const meeCacheManager = new MEECacheManager();
