/**
 * startModelDownload — the single download action shared by the Models screen and
 * the onboarding ModelDownloadScreen. Verifies the duplicate guard, the
 * downloadModelBackground→watchDownload wiring, register+clear on completion, and the
 * error path (failed status + onError).
 */
const mockDownloadModelBackground = jest.fn();
const mockWatchDownload = jest.fn();
jest.mock('../../../src/services/modelManager', () => ({
  modelManager: {
    downloadModelBackground: (...a: unknown[]) => mockDownloadModelBackground(...a),
    watchDownload: (...a: unknown[]) => mockWatchDownload(...a),
  },
}));

const mockStore: { downloads: Record<string, { status: string }>; remove: jest.Mock; setStatus: jest.Mock } = {
  downloads: {}, remove: jest.fn(), setStatus: jest.fn(),
};
jest.mock('../../../src/stores/downloadStore', () => ({
  useDownloadStore: { getState: () => mockStore },
  isActiveStatus: (s: string) => ['pending', 'running', 'retrying', 'waiting_for_network', 'processing'].includes(s),
}));

const mockAddDownloadedModel = jest.fn();
jest.mock('../../../src/stores', () => ({
  useAppStore: { getState: () => ({ addDownloadedModel: mockAddDownloadedModel }) },
}));
jest.mock('../../../src/utils/modelKey', () => ({ makeModelKey: (id: string, f: string) => `${id}/${f}` }));

import { startModelDownload } from '../../../src/services/startModelDownload';

const MODEL_ID = 'author/model';
const FILE = { name: 'model.gguf' } as any;
const KEY = 'author/model/model.gguf';

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.downloads = {};
});

describe('startModelDownload', () => {
  it('starts the download and wires watchDownload; completion registers + clears + onRegistered', async () => {
    mockDownloadModelBackground.mockResolvedValue({ downloadId: 'dl-1' });
    let onComplete: ((m: any) => void) | undefined;
    mockWatchDownload.mockImplementation((_id, c) => { onComplete = c; });
    const onRegistered = jest.fn();

    await startModelDownload(MODEL_ID, FILE, { onRegistered });

    expect(mockDownloadModelBackground).toHaveBeenCalledWith(MODEL_ID, FILE);
    expect(mockWatchDownload).toHaveBeenCalled();

    const dm = { id: KEY };
    onComplete!(dm);
    expect(mockAddDownloadedModel).toHaveBeenCalledWith(dm);
    expect(mockStore.remove).toHaveBeenCalledWith(KEY);
    expect(onRegistered).toHaveBeenCalledWith(dm);
  });

  it('is a no-op when a download is already active (duplicate guard)', async () => {
    mockStore.downloads = { [KEY]: { status: 'running' } };
    await startModelDownload(MODEL_ID, FILE, {});
    expect(mockDownloadModelBackground).not.toHaveBeenCalled();
  });

  it('surfaces a start failure via onError without a downloadId (no setStatus)', async () => {
    mockDownloadModelBackground.mockRejectedValue(new Error('boom'));
    const onError = jest.fn();
    await startModelDownload(MODEL_ID, FILE, { onError });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
    expect(mockStore.setStatus).not.toHaveBeenCalled();
  });

  it('marks the entry failed + calls onError when watchDownload reports an error', async () => {
    mockDownloadModelBackground.mockResolvedValue({ downloadId: 'dl-1' });
    let onErr: ((e: Error) => void) | undefined;
    mockWatchDownload.mockImplementation((_id, _c, e) => { onErr = e; });
    const onError = jest.fn();

    await startModelDownload(MODEL_ID, FILE, { onError });
    onErr!(new Error('net'));

    expect(mockStore.setStatus).toHaveBeenCalledWith('dl-1', 'failed', { message: 'net' });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'net' }));
  });
});
