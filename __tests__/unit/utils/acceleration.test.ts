import { isAccelerableQuant, modelSupportsNpuGpu } from '../../../src/utils/acceleration';

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
