/**
 * DEVICE 2026-07-14 — a gguf vision request errored "Multimodal support not enabled. Call initMultimodal
 * first." because the E2B model was paired with the E4B mmproj (both projectors sit in the shared models
 * dir, and the resolver grabbed the first). The wrong projector → initMultimodal returns false → vision off.
 *
 * pickMmProjForModel must pick the projector that belongs to the model. Real function, no mocks.
 */
import { pickMmProjForModel, mmProjBelongsToModel } from '../../../src/services/activeModelService/loaders';

describe('pickMmProjForModel — the projector matches the model, not just the first mmproj in the dir', () => {
  const E2B = 'gemma-4-E2B-it-Q4_K_M.gguf';
  const E2B_MMPROJ = 'gemma-4-E2B-it-Q4_K_M-mmproj.gguf';
  const E4B_MMPROJ = 'gemma-4-E4B-it-Q4_K_M-mmproj.gguf';

  it('pairs the E2B model with the E2B projector even when the E4B projector is listed first', () => {
    // E4B first — the exact device ordering that mispaired. The fix must NOT return it for an E2B model.
    expect(pickMmProjForModel(E2B, [E4B_MMPROJ, E2B_MMPROJ])).toBe(E2B_MMPROJ);
  });

  it('pairs the E4B model with the E4B projector (symmetric)', () => {
    expect(pickMmProjForModel('gemma-4-E4B-it-Q4_K_M.gguf', [E2B_MMPROJ, E4B_MMPROJ])).toBe(E4B_MMPROJ);
  });

  it('returns the only projector when a single one is present (unambiguous, unchanged behavior)', () => {
    expect(pickMmProjForModel(E2B, [E2B_MMPROJ])).toBe(E2B_MMPROJ);
    expect(pickMmProjForModel(E2B, [])).toBeUndefined();
  });

  it('QUANT TRAP: E2B model (Q4_K_M) picks the E2B projector even when the ONLY same-quant projector is E4B', () => {
    // The projector is quant-independent, so an E2B model with a Q8_0-named E2B projector must still beat an
    // E4B projector that happens to share the model's Q4_K_M quant. Naive quant/token matching picks E4B here.
    const E2B_MMPROJ_Q8 = 'gemma-4-E2B-it-Q8_0-mmproj.gguf';
    expect(pickMmProjForModel(E2B, [E4B_MMPROJ, E2B_MMPROJ_Q8])).toBe(E2B_MMPROJ_Q8);
  });

  it('same model, different quantizations, one shared projector → that projector is used for every quant', () => {
    // The user case: one mmproj, multiple model quants. Each quant resolves to the same (E2B) projector.
    expect(pickMmProjForModel('gemma-4-E2B-it-Q4_K_M.gguf', [E2B_MMPROJ])).toBe(E2B_MMPROJ);
    expect(pickMmProjForModel('gemma-4-E2B-it-Q8_0.gguf', [E2B_MMPROJ])).toBe(E2B_MMPROJ);
    // …and with an E4B projector also present, each E2B quant still avoids it.
    expect(pickMmProjForModel('gemma-4-E2B-it-Q8_0.gguf', [E4B_MMPROJ, E2B_MMPROJ])).toBe(E2B_MMPROJ);
  });

  describe('mmProjBelongsToModel — the fast-path self-heal gate (reject a stale mismatched projector)', () => {
    it('rejects the E4B projector persisted onto the E2B model (the exact device mispairing)', () => {
      expect(mmProjBelongsToModel(E2B, E4B_MMPROJ)).toBe(false);
    });
    it('accepts the correct projector regardless of quant', () => {
      expect(mmProjBelongsToModel(E2B, E2B_MMPROJ)).toBe(true);
      expect(mmProjBelongsToModel(E2B, 'gemma-4-E2B-it-Q8_0-mmproj.gguf')).toBe(true);
    });
  });
});
