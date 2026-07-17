/** Full-App message action journeys reached through rendered chat gestures. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

describe('full-app message actions', () => {
  it('copies a visible assistant reply through its action sheet', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
    });
    const { fireEvent, waitFor } = rtl;
    const { Clipboard } = require('react-native') as {
      Clipboard: { setString(value: string): void };
    };
    let clipboardText = '';
    Clipboard.setString = value => {
      clipboardText = value;
    };

    await openChatWithJourneyModel(rtl, view);
    boundary.llama!.scriptCompletion({
      text: 'This reply should be copied exactly.',
    });
    sendChatMessage(rtl, view, 'Give me a short answer');
    await waitFor(() =>
      expect(
        view.getByText('This reply should be copied exactly.'),
      ).toBeTruthy(),
    );

    fireEvent(view.getByTestId('assistant-message'), 'longPress');
    fireEvent.press(await waitFor(() => view.getByTestId('action-copy')));
    await waitFor(() => {
      expect(view.getByText('Message copied to clipboard')).toBeTruthy();
      expect(clipboardText).toBe('This reply should be copied exactly.');
    });
    view.unmount();
  });
});
