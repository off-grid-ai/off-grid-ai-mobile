/**
 * RED-FLOW (UI integration) — image-settings bugs Q12 + Q13. Pure store + render: mounts the REAL
 * GenerationSettingsModal over the REAL appStore (no native leaf, so no harness needed) and asserts
 * what the user sees on the sliders. Deleting/altering the real store logic changes the result.
 *
 * Q12 — "Reset to Defaults" resets only the 7 text params (index.tsx DEFAULT_SETTINGS), never the image
 *       ones, so after a reset the Image Size the user sees is unchanged.
 * Q13 — the chat modal's Image Size clamps display to Math.max(256, imageWidth) (ImageQualitySliders:47),
 *       so a persisted 128 (settable from Model Settings, min 128) shows as 256 here — the two surfaces
 *       diverge (the root of Q1).
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { GenerationSettingsModal } from '../../../src/components/GenerationSettingsModal';
import { useAppStore } from '../../../src/stores';

/** Open Image section + its advanced controls so the Image Size slider is on screen. */
function openImageSettings(view: ReturnType<typeof render>) {
  fireEvent.press(view.getByText('IMAGE GENERATION'));
  fireEvent.press(view.getByTestId('modal-image-advanced-toggle'));
}

describe('image settings — UI red-flow (assert what the user sees)', () => {
  it('Q12: "Reset to Defaults" also resets the Image Size the user sees', () => {
    // User previously set a large image size.
    useAppStore.getState().updateSettings({ imageWidth: 512, imageHeight: 512 });

    const view = render(<GenerationSettingsModal visible onClose={() => {}} />);
    openImageSettings(view);
    expect(view.getByText('512x512')).toBeTruthy(); // precondition: the custom size is shown

    fireEvent.press(view.getByText('Reset to Defaults'));

    // Correct: reset returns image size to the 256 default. Today only text params reset, so the
    // slider still shows 512x512 → RED.
    expect(view.queryByText('512x512')).toBeNull();
    expect(view.queryByText('256x256')).not.toBeNull();
  });

  it('Q13: the chat modal reflects the Image Size the user set (128), not a clamped 256', () => {
    // A width of 128 is settable + persisted from the Model Settings screen (its slider min is 128).
    useAppStore.getState().updateSettings({ imageWidth: 128, imageHeight: 128 });

    const view = render(<GenerationSettingsModal visible onClose={() => {}} />);
    openImageSettings(view);

    // The slider IS on screen but clamped: the modal shows "256x256" (proves the render happened,
    // not a missing-element false red)...
    expect(view.queryByText('256x256')).not.toBeNull();
    // ...while the value the user actually set (128) is nowhere to be seen. Correct: both surfaces
    // agree on the persisted 128 → "128x128" shown. Today it's clamped away → RED.
    expect(view.queryByText('128x128')).not.toBeNull();
  });
});
