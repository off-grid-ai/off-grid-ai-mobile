import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useAccelerationTip } from '../../../../src/screens/ChatScreen/useAccelerationTip';
import { hardwareService } from '../../../../src/services/hardware';
import { useAppStore } from '../../../../src/stores';
import { INFERENCE_BACKENDS } from '../../../../src/types';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const mockUpdateSettings = jest.fn();
jest.spyOn(useAppStore, 'getState').mockReturnValue({ updateSettings: mockUpdateSettings } as any);

const llama = { id: 'unsloth/Qwen3-4B-Instruct-Q4_K_M', engine: 'llama' } as any;

describe('useAccelerationTip', () => {
  beforeEach(() => jest.clearAllMocks());

  it('becomes visible for a local llama model on CPU once an NPU is detected', async () => {
    jest.spyOn(hardwareService, 'getAccelerationCapability').mockResolvedValue({ hasNpu: true, hasGpu: false });
    const { result } = renderHook(() =>
      useAccelerationTip({ activeModel: llama, isRemote: false, inferenceBackend: INFERENCE_BACKENDS.CPU }));
    await waitFor(() => expect(result.current.visible).toBe(true));
    expect(result.current.hasNpu).toBe(true);
  });

  it('stays hidden when the device cannot accelerate', async () => {
    jest.spyOn(hardwareService, 'getAccelerationCapability').mockResolvedValue({ hasNpu: false, hasGpu: false });
    const { result } = renderHook(() =>
      useAccelerationTip({ activeModel: llama, isRemote: false, inferenceBackend: INFERENCE_BACKENDS.CPU }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.visible).toBe(false);
  });

  it('enableAcceleration switches to HTP when an NPU is present', async () => {
    jest.spyOn(hardwareService, 'getAccelerationCapability').mockResolvedValue({ hasNpu: true, hasGpu: true });
    const { result } = renderHook(() =>
      useAccelerationTip({ activeModel: llama, isRemote: false, inferenceBackend: INFERENCE_BACKENDS.CPU }));
    await waitFor(() => expect(result.current.visible).toBe(true));
    act(() => result.current.enableAcceleration());
    expect(mockUpdateSettings).toHaveBeenCalledWith({ inferenceBackend: INFERENCE_BACKENDS.HTP });
  });

  it('enableAcceleration switches to OpenCL when only a GPU is present', async () => {
    jest.spyOn(hardwareService, 'getAccelerationCapability').mockResolvedValue({ hasNpu: false, hasGpu: true });
    const { result } = renderHook(() =>
      useAccelerationTip({ activeModel: llama, isRemote: false, inferenceBackend: INFERENCE_BACKENDS.CPU }));
    await waitFor(() => expect(result.current.visible).toBe(true));
    act(() => result.current.enableAcceleration());
    expect(mockUpdateSettings).toHaveBeenCalledWith({ inferenceBackend: INFERENCE_BACKENDS.OPENCL });
  });

  it('getAcceleratedModel opens the Models tab with a prefilled Q4_0 search', async () => {
    jest.spyOn(hardwareService, 'getAccelerationCapability').mockResolvedValue({ hasNpu: true, hasGpu: false });
    const { result } = renderHook(() =>
      useAccelerationTip({ activeModel: llama, isRemote: false, inferenceBackend: INFERENCE_BACKENDS.CPU }));
    act(() => result.current.getAcceleratedModel());
    expect(mockNavigate).toHaveBeenCalledWith('Main', {
      screen: 'ModelsTab',
      params: { initialTab: 'text', initialSearchQuery: 'Qwen3-4B-Instruct Q4_0' },
    });
  });
});
