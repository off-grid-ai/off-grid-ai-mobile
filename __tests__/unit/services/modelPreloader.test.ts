/**
 * modelPreloader tests — warms selected models in priority order (text → image
 * → TTS → STT), only loading what fits the budget without eviction.
 */
let mockAppState: any;
let mockWhisperState: any;
jest.mock('../../../src/stores', () => ({
  useAppStore: { getState: () => mockAppState },
  useWhisperStore: { getState: () => mockWhisperState },
}));

const mockLoadText = jest.fn((..._a: any[]) => Promise.resolve());
const mockLoadImage = jest.fn((..._a: any[]) => Promise.resolve());
const mockGetActiveModels = jest.fn(() => ({ text: { isLoaded: false }, image: { isLoaded: false } }));
jest.mock('../../../src/services/activeModelService', () => ({
  activeModelService: {
    loadTextModel: (...a: any[]) => mockLoadText(...a),
    loadImageModel: (...a: any[]) => mockLoadImage(...a),
    getActiveModels: () => mockGetActiveModels(),
  },
}));

jest.mock('../../../src/services/hardware', () => ({
  hardwareService: { estimateModelRam: (m: any) => (m.fileSize || m.size || 0) * 1.5 },
}));

jest.mock('../../../src/services/whisperService', () => ({
  WHISPER_MODELS: [{ id: 'w1', size: 150 }],
}));

const mockCanLoad = jest.fn((_spec?: any) => true);
jest.mock('../../../src/services/modelResidency', () => ({
  modelResidencyManager: { canLoadWithoutEviction: (...a: any[]) => mockCanLoad(...a) },
}));

const mockCallHook = jest.fn((..._a: any[]) => Promise.resolve());
jest.mock('../../../src/bootstrap/hookRegistry', () => ({
  callHook: (...a: any[]) => mockCallHook(...a),
  HOOKS: { audioPreload: 'audio.preload' },
}));

import { preloadSelectedModels, _resetPreloaderForTesting } from '../../../src/services/modelPreloader';

describe('preloadSelectedModels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetPreloaderForTesting();
    mockCanLoad.mockReturnValue(true);
    mockGetActiveModels.mockReturnValue({ text: { isLoaded: false }, image: { isLoaded: false } });
    mockAppState = {
      activeModelId: 'txt', lastTextModelId: 'txt',
      downloadedModels: [{ id: 'txt', fileSize: 1024 * 1024 * 700 }],
      activeImageModelId: 'img',
      downloadedImageModels: [{ id: 'img', size: 1024 * 1024 * 400 }],
    };
    mockWhisperState = { downloadedModelId: 'w1', isModelLoaded: false, loadModel: jest.fn(() => Promise.resolve()) };
  });

  it('warms all selected models in order when they fit', async () => {
    await preloadSelectedModels();
    expect(mockLoadText).toHaveBeenCalledWith('txt');
    expect(mockLoadImage).toHaveBeenCalledWith('img');
    expect(mockCallHook).toHaveBeenCalledWith('audio.preload');
    expect(mockWhisperState.loadModel).toHaveBeenCalled();
  });

  it('skips a model that would require eviction (does not block lower priority)', async () => {
    // Image doesn't fit; text/tts/stt still load.
    mockCanLoad.mockImplementation((spec: any) => spec.key !== 'image');
    await preloadSelectedModels();
    expect(mockLoadText).toHaveBeenCalled();
    expect(mockLoadImage).not.toHaveBeenCalled();
    expect(mockCallHook).toHaveBeenCalledWith('audio.preload');
    expect(mockWhisperState.loadModel).toHaveBeenCalled();
  });

  it('skips models that are already loaded', async () => {
    mockGetActiveModels.mockReturnValue({ text: { isLoaded: true }, image: { isLoaded: true } });
    await preloadSelectedModels();
    expect(mockLoadText).not.toHaveBeenCalled();
    expect(mockLoadImage).not.toHaveBeenCalled();
  });

  it('runs only once', async () => {
    await preloadSelectedModels();
    await preloadSelectedModels();
    expect(mockLoadText).toHaveBeenCalledTimes(1);
  });

  it('no-ops for unselected modalities', async () => {
    mockAppState.activeModelId = null;
    mockAppState.lastTextModelId = null;
    mockAppState.activeImageModelId = null;
    mockWhisperState.downloadedModelId = null;
    await preloadSelectedModels();
    expect(mockLoadText).not.toHaveBeenCalled();
    expect(mockLoadImage).not.toHaveBeenCalled();
    expect(mockWhisperState.loadModel).not.toHaveBeenCalled();
  });
});
