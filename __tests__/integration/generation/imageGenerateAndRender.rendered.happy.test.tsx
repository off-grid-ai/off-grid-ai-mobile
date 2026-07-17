/** P0 #66 — select a downloaded image model, generate, and render through the real App. */
import { renderMainApp } from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const MODEL_PATH = '/docs/image_models/journey-mnn';
const IMAGE_MODELS_KEY = '@local_llm/downloaded_image_models';
const REQUIRED_MNN_FILES = [
  'pos_emb.bin',
  'token_emb.bin',
  'tokenizer.json',
  'unet.mnn',
  'unet.mnn.weight',
  'vae_decoder.mnn',
  'vae_decoder.mnn.weight',
  'clip_v2.mnn',
  'clip_v2.mnn.weight',
] as const;

describe('P0 image-generation journey', () => {
  it('generates and renders an image after the user selects an MNN model', async () => {
    const imageModel = {
      id: 'journey-mnn',
      name: 'Journey Image',
      description: 'Full-app image generation fixture',
      modelPath: MODEL_PATH,
      downloadedAt: '2026-07-17T00:00:00.000Z',
      size: 512 * 1024 * 1024,
      style: 'Image',
      backend: 'mnn' as const,
    };
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
      beforeRender: async ({ boundary: native, asyncStorage }) => {
        REQUIRED_MNN_FILES.forEach(file =>
          native.fs!.seedFile(`${MODEL_PATH}/${file}`, 8 * 1024 * 1024),
        );
        await asyncStorage.setItem(
          IMAGE_MODELS_KEY,
          JSON.stringify([imageModel]),
        );
      },
    });
    const { act, fireEvent, waitFor } = rtl;

    await waitFor(() =>
      expect(view.getByTestId('model-summary-count-image')).toHaveTextContent(
        '1',
      ),
    );
    await act(async () => {
      fireEvent.press(view.getByTestId('models-summary'));
    });
    await waitFor(() =>
      expect(view.getByTestId('models-row-image')).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(view.getByTestId('models-row-image'));
    });
    await waitFor(() => expect(view.getByText('Journey Image')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('model-item'));
    });
    await waitFor(() =>
      expect(view.getByTestId('new-chat-button')).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(view.getByTestId('new-chat-button'));
    });
    await waitFor(() => expect(view.getByTestId('chat-screen')).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByTestId('quick-settings-button'));
    });
    await waitFor(() =>
      expect(view.getByTestId('quick-image-mode')).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(view.getByTestId('quick-image-mode'));
    });
    await waitFor(() =>
      expect(view.getByTestId('image-mode-force-badge')).toBeTruthy(),
    );

    const ReactNative =
      require('react-native') as typeof import('react-native');
    const visibleModal = view
      .UNSAFE_getAllByType(ReactNative.Modal)
      .find(modal => modal.props.visible);
    expect(visibleModal).toBeTruthy();
    await act(async () => {
      fireEvent(visibleModal!, 'requestClose');
    });

    fireEvent.changeText(view.getByTestId('chat-input'), 'a fox in snow');
    fireEvent.press(view.getByTestId('send-button'));
    await waitFor(
      () => {
        expect(view.getByTestId('generated-image')).toBeTruthy();
        expect(view.getByTestId('generated-image-content')).toBeTruthy();
        expect(
          view.getByText(/Generated image for:.*a fox in snow/),
        ).toBeTruthy();
      },
      { timeout: 8000 },
    );
    expect(boundary.diffusion.calls.generateImage).toHaveLength(1);
    expect(boundary.diffusion.module.loadModel).toHaveBeenCalledWith(
      expect.objectContaining({ modelPath: MODEL_PATH }),
    );
    view.unmount();
  }, 30000);
});
