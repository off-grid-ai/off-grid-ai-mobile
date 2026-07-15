/**
 * RED-FLOW (UI, rendered) — the onboarding ModelDownloadScreen's curated-LiteRT memory warning must be
 * REACHABLE for an over-budget model.
 *
 * SPEC (the OGAM user's view): the curated Gemma 4 E4B carries a `confirmDownload` warning ("may exceed
 * your device's memory ... Download anyway"). On a device where E4B genuinely exceeds the RAM budget, the
 * onboarding screen must OFFER E4B with that warning — tapping Download shows the confirm sheet, and the
 * user can proceed with "Download anyway". The warning is the owned device-aware decision
 * (curatedLiteRTDownloadWarning → fileExceedsBudget).
 *
 * The bug (device gap): the screen pre-filters `liteRTFiles` to only files that FIT the budget, so the
 * over-budget E4B — the only file for which the warning would fire — is never rendered, and
 * handleLiteRTDownload's warning branch is dead code. The warning can NEVER show.
 *
 * This mounts the REAL ModelDownloadScreen on a low-RAM Android device (E4B over budget), and asserts the
 * E4B card renders and tapping its Download shows the confirm sheet with "Download anyway". Boundary fakes
 * only: native download + fs + RAM (installNativeBoundary), the HuggingFace network transport
 * (getModelFiles → [] so the only card is the curated LiteRT one), and navigation (a fake prop).
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

const WARNING_MESSAGE = /may exceed your device's memory/;

describe('onboarding curated-LiteRT over-budget warning is reachable (red-flow)', () => {
  it('offers the over-budget E4B and its Download shows the confirm sheet with Download anyway', async () => {
    // 5GB Android → budget = 5 * modelBudgetFraction(5)=0.60 = 3.0GB. E2B (2.41GB) FITS, E4B (3.41GB)
    // EXCEEDS — the exact "one fits, one warns" split, proving the warning is reachable specifically for
    // the over-budget file.
    installNativeBoundary({ download: true, fs: true, ram: { platform: 'android', totalBytes: 5 * GB, availBytes: 3 * GB } });

    jest.doMock('../../../src/services/huggingface', () => ({
      huggingFaceService: {
        // No recommended HF files → the only cards are the curated LiteRT ones.
        getModelFiles: jest.fn(async () => []),
        searchModels: jest.fn(async () => []),
        getModelDetails: jest.fn(async () => null),
        getDownloadUrl: (m: string, f: string, r = 'main') => `https://hf.co/${m}/resolve/${r}/${f}`,
        formatModelSize: jest.fn(() => '3.4 GB'),
        formatFileSize: jest.fn((b: number) => `${(b / GB).toFixed(1)} GB`),
      },
    }));

    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render, fireEvent, waitFor, act } = requireRTL();
    const { hardwareService } = require('../../../src/services/hardware');
    const { fileExceedsBudget } = require('../../../src/services/memoryBudget');
    const { ModelDownloadScreen } = require('../../../src/screens/ModelDownloadScreen');
    /* eslint-enable @typescript-eslint/no-var-requires */

    await hardwareService.refreshMemoryInfo();
    const ramGB = hardwareService.getTotalMemoryGB();
    // Owner verdict on this device: E2B fits, E4B exceeds → E4B is the warning case.
    expect(fileExceedsBudget(2588147712, ramGB)).toBe(false); // E2B fits
    expect(fileExceedsBudget(3659530240, ramGB)).toBe(true);  // E4B exceeds

    const navigation = { navigate: () => {}, goBack: () => {}, replace: () => {}, setOptions: () => {}, addListener: () => () => {} } as any;
    const utils = render(React.createElement(ModelDownloadScreen, { navigation }));
    const { getByText, queryByText, getByTestId } = utils;

    // The over-budget E4B card must be OFFERED (it carries the warning affordance), not hidden.
    await waitFor(() => expect(getByText('Gemma 4 E4B')).toBeTruthy(), { timeout: 6000 });

    // Precondition: the confirm sheet is NOT already on screen.
    expect(queryByText(WARNING_MESSAGE)).toBeNull();
    expect(queryByText('Download anyway')).toBeNull();

    // Tap the E4B card's Download control. The cards render smallest-first: E2B (index 0), E4B (index 1).
    await act(async () => { fireEvent.press(getByTestId('litert-model-1-download')); });

    // TERMINAL artifact: the device-aware warning sheet appears with a "Download anyway" escape hatch.
    await waitFor(() => expect(queryByText(WARNING_MESSAGE)).not.toBeNull(), { timeout: 4000 });
    expect(queryByText('Download anyway')).not.toBeNull();
  }, 30000);
});
