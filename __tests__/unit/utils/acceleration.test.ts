import {
  isAccelerableQuant,
  modelSupportsNpuGpu,
  shouldSuggestAcceleration,
  acceleratedBackendFor,
  acceleratedSearchQuery,
} from '../../../src/utils/acceleration';
import { INFERENCE_BACKENDS } from '../../../src/types';

const file = (name: string, quantization: string) => ({ name, size: 1, quantization, downloadUrl: '' });

describe('isAccelerableQuant', () => {
  it('accepts the NPU/GPU-accelerable GGUF quants (case-insensitive)', () => {
    expect(isAccelerableQuant('Q4_0')).toBe(true);
    expect(isAccelerableQuant('q4_0')).toBe(true);
    expect(isAccelerableQuant('Q8_0')).toBe(true);
  });

  it('rejects K-quants and unknowns (they silently fall back to CPU)', () => {
    expect(isAccelerableQuant('Q4_K_M')).toBe(false);
    expect(isAccelerableQuant('Q6_K')).toBe(false);
    expect(isAccelerableQuant('Unknown')).toBe(false);
    expect(isAccelerableQuant(undefined)).toBe(false);
    expect(isAccelerableQuant('')).toBe(false);
  });
});

describe('modelSupportsNpuGpu', () => {
  it('true when the model offers a Q4_0 or Q8_0 GGUF file', () => {
    expect(modelSupportsNpuGpu({ files: [file('m-Q4_K_M.gguf', 'Q4_K_M'), file('m-Q4_0.gguf', 'Q4_0')] })).toBe(true);
    expect(modelSupportsNpuGpu({ files: [file('m-Q8_0.gguf', 'Q8_0')] })).toBe(true);
  });

  it('true for a LiteRT model (runs on GPU regardless of quant)', () => {
    expect(modelSupportsNpuGpu({ files: [file('gemma-4-E2B-it.litertlm', 'LiteRT')] })).toBe(true);
    expect(modelSupportsNpuGpu({ files: [file('x.litertlm', 'Unknown')] })).toBe(true);
  });

  it('false when the model only offers K-quants (no acceleration)', () => {
    expect(modelSupportsNpuGpu({ files: [file('m-Q4_K_M.gguf', 'Q4_K_M'), file('m-Q6_K.gguf', 'Q6_K')] })).toBe(false);
  });

  it('false when there are no files', () => {
    expect(modelSupportsNpuGpu({ files: [] })).toBe(false);
    expect(modelSupportsNpuGpu({ files: undefined as never })).toBe(false);
  });
});

describe('shouldSuggestAcceleration', () => {
  const base = { engine: 'llama', isRemote: false, inferenceBackend: INFERENCE_BACKENDS.CPU };

  it('true for a local llama model on CPU when the device has an NPU', () => {
    expect(shouldSuggestAcceleration({ ...base, capability: { hasNpu: true, hasGpu: false } })).toBe(true);
  });

  it('true for a local llama model on CPU when the device has a GPU', () => {
    expect(shouldSuggestAcceleration({ ...base, capability: { hasNpu: false, hasGpu: true } })).toBe(true);
  });

  it('false once already on an accelerated backend', () => {
    expect(shouldSuggestAcceleration({ ...base, inferenceBackend: INFERENCE_BACKENDS.HTP, capability: { hasNpu: true, hasGpu: false } })).toBe(false);
    expect(shouldSuggestAcceleration({ ...base, inferenceBackend: INFERENCE_BACKENDS.OPENCL, capability: { hasNpu: false, hasGpu: true } })).toBe(false);
  });

  it('false when the device has neither NPU nor GPU', () => {
    expect(shouldSuggestAcceleration({ ...base, capability: { hasNpu: false, hasGpu: false } })).toBe(false);
  });

  it('false for LiteRT and remote models (they do not use the llama.rn backend)', () => {
    const cap = { hasNpu: true, hasGpu: true };
    expect(shouldSuggestAcceleration({ ...base, engine: 'litert', capability: cap })).toBe(false);
    expect(shouldSuggestAcceleration({ ...base, isRemote: true, capability: cap })).toBe(false);
    expect(shouldSuggestAcceleration({ ...base, engine: undefined, capability: cap })).toBe(false);
  });
});

describe('acceleratedBackendFor', () => {
  it('prefers the NPU (HTP) when available, else the GPU (OpenCL)', () => {
    expect(acceleratedBackendFor({ hasNpu: true, hasGpu: true })).toBe(INFERENCE_BACKENDS.HTP);
    expect(acceleratedBackendFor({ hasNpu: false, hasGpu: true })).toBe(INFERENCE_BACKENDS.OPENCL);
  });
});

describe('acceleratedSearchQuery', () => {
  it('strips the author prefix and quant suffix, then appends Q4_0', () => {
    expect(acceleratedSearchQuery('unsloth/Qwen3-4B-Instruct-Q4_K_M')).toBe('Qwen3-4B-Instruct Q4_0');
    expect(acceleratedSearchQuery('org/gemma-3-4b-it')).toBe('gemma-3-4b-it Q4_0');
  });

  it('falls back to a bare Q4_0 search when the id is missing', () => {
    expect(acceleratedSearchQuery(undefined)).toBe('Q4_0');
    expect(acceleratedSearchQuery(null)).toBe('Q4_0');
  });
});
