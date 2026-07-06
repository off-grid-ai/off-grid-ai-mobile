/**
 * Hardware-acceleration eligibility — the SINGLE source of truth for "can this
 * model actually use the GPU/NPU?".
 *
 * Grounded in what llama.rn / llama.cpp actually accelerate on-device:
 *  - HTP/Hexagon NPU repacks only Q4_0, Q8_0 (and MXFP4). A K-quant (Q4_K_M)
 *    loads but silently runs on CPU — no speedup.
 *  - The Adreno OpenCL GPU backend is optimized for Q4_0 (llama.rn restricts it to
 *    Q4_0/Q6_K).
 *  - LiteRT (.litertlm) models run on the GPU natively.
 * So the accelerable GGUF quants are Q4_0 / Q8_0; LiteRT files are always GPU.
 * See docs/plans/best-backend-per-device.md and the HTP/OpenCL research.
 */
import { ModelInfo, ModelFile } from '../types';

/** GGUF quantizations the NPU (HTP) / GPU (OpenCL) backends actually accelerate. */
export const ACCELERABLE_QUANTS = ['Q4_0', 'Q8_0'] as const;

/** True when a GGUF quant is one the NPU/GPU backends accelerate (not a K-quant). */
export function isAccelerableQuant(quant: string | undefined | null): boolean {
  if (!quant) return false;
  const q = quant.toUpperCase();
  return ACCELERABLE_QUANTS.some(a => a === q);
}

/** A LiteRT model file runs on the GPU regardless of GGUF quant. */
function isLiteRTFile(file: ModelFile): boolean {
  return file.name.toLowerCase().endsWith('.litertlm') || file.quantization?.toLowerCase() === 'litert';
}

/**
 * Whether a model can run on the GPU/NPU: it ships a LiteRT file, or a GGUF file in
 * an accelerable quant (Q4_0/Q8_0) the user can pick. A model that only offers
 * K-quants (Q4_K_M) returns false — enabling NPU/GPU for it would silently fall
 * back to CPU, so we neither badge nor prioritize it.
 */
export function modelSupportsNpuGpu(model: Pick<ModelInfo, 'files'>): boolean {
  return (model.files ?? []).some(f => isLiteRTFile(f) || isAccelerableQuant(f.quantization));
}
