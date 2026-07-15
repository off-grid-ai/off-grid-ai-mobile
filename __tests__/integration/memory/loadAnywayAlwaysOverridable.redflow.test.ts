/**
 * RED-FLOW (integration) — a memory refusal on model load must ALWAYS be overridable ("Load Anyway"),
 * in every mode, on every path. Never a dead-end.
 *
 * DEVICE (2026-07-15, 12 GB iPhone 17 Pro Max, Aggressive): loading a ~6.7 GB text model ("qwythos")
 * failed with a plain "Error / Failed to load model: … it needs ~6738MB but only 5030MB is available"
 * alert that had ONLY an OK button — NO Load Anyway. Root cause: the pre-load memory gate
 * (llmSafetyChecks.resolveSafeContext) threw a plain `Error` when the weights exceed available RAM.
 * loadModelWithOverride only offers Load Anyway for an OverridableMemoryError; a plain Error falls to
 * the dead-end "Failed to load model" alert. So the whole Load-Anyway-always guarantee was bypassed on
 * the text pre-load path (the image path already routes through makeRoomFor → OverridableMemoryError).
 *
 * This drives the REAL gate over the injected memory sensor (the device boundary): weights bigger than
 * available, no override → it must throw an OVERRIDABLE error so the UI shows Load Anyway. Then override
 * → it must proceed. RED on HEAD: the throw is a plain Error → isOverridableMemoryError === false.
 */
import { resolveSafeContext } from '../../../src/services/llmSafetyChecks';
import { isOverridableMemoryError } from '../../../src/utils/modelLoadErrors';

const MB = 1024 * 1024;
const GB = 1024 * MB;

// Device boundary: the memory sensor. 12 GB device, but only ~5030 MB free right now (the exact
// device number) — reclaim-aware or not, this is what the gate saw when it refused with no Load Anyway.
const memSensor = (availableMB: number, totalMB = 12 * 1024) =>
  async () => ({ available: availableMB * MB, total: totalMB * MB });

describe('memory refusal is always overridable (Load Anyway), any mode (red-flow)', () => {
  it('throws an OVERRIDABLE error when model weights exceed available RAM (drives Load Anyway)', async () => {
    let thrown: unknown;
    try {
      // ~5.6 GB file → ~6.7 GB weights estimate (fileSize * 1.2), only 5030 MB free → must refuse.
      await resolveSafeContext({
        fileSize: Math.round(5.6 * GB),
        requestedCtx: 4096,
        quantizedCache: false,
        override: false,
        getAvailableMemory: memSensor(5030),
      });
    } catch (e) {
      thrown = e;
    }
    // It must refuse — and the refusal MUST be overridable so the UI offers "Load Anyway".
    expect(thrown).toBeInstanceOf(Error);
    expect(isOverridableMemoryError(thrown)).toBe(true); // RED on HEAD: plain Error → false → dead-end alert
  });

  it('proceeds (no throw) once the user overrides — Load Anyway actually loads', async () => {
    const res = await resolveSafeContext({
      fileSize: Math.round(5.6 * GB),
      requestedCtx: 4096,
      quantizedCache: false,
      override: true,
      getAvailableMemory: memSensor(5030),
    });
    expect(res.ctxLen).toBeGreaterThan(0); // override skips the hard block and returns a context to load at
  });
});
