import { renderMainApp } from '../../harness/appJourney';

describe('experimental features settings journey', () => {
  it('opens the experimental screen and opts into Multi-Token Prediction', async () => {
    const { rtl, view } = await renderMainApp();

    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    await rtl.waitFor(() =>
      expect(view.getByText('Experimental Features')).toBeTruthy(),
    );

    rtl.fireEvent.press(view.getByText('Experimental Features'));
    await rtl.waitFor(() =>
      expect(view.getByText('Multi-Token Prediction')).toBeTruthy(),
    );

    const toggle = view.getByTestId('experimental-mtp-toggle');
    expect(toggle.props.accessibilityState?.checked).toBe(false);
    rtl.fireEvent(toggle, 'valueChange', true);

    await rtl.waitFor(() =>
      expect(
        view.getByTestId('experimental-mtp-toggle').props.accessibilityState
          ?.checked,
      ).toBe(true),
    );
    expect(view.getByText('EXPERIMENTAL')).toBeTruthy();
    expect(
      view.getByText(/Reload the model after changing this setting/),
    ).toBeTruthy();
  });
});
