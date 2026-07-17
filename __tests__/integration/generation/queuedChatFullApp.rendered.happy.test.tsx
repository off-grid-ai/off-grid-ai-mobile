/** P1 #44 — a second rendered send queues behind an in-flight GGUF turn. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

describe('P1 full-app queued chat journey', () => {
  it('shows queued feedback and drains the second turn after the first finishes', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
    });
    boundary.llama!.scriptCompletions([
      {
        text: 'First response complete.',
        pauseAfter: 'First response',
      },
      { text: 'Second response complete.' },
    ]);
    await openChatWithJourneyModel(rtl, view);

    sendChatMessage(rtl, view, 'first prompt');
    await rtl.waitFor(() => {
      expect(view.getByText('First response')).toBeTruthy();
      expect(view.getByTestId('stop-button')).toBeTruthy();
    });

    sendChatMessage(rtl, view, 'second prompt');
    await rtl.waitFor(() => {
      expect(view.getByTestId('queue-indicator')).toBeTruthy();
      expect(view.getByText('1 queued')).toBeTruthy();
    });

    boundary.llama!.releaseStream();
    await rtl.waitFor(
      () => {
        expect(view.getByText('First response complete.')).toBeTruthy();
        expect(view.getByText('Second response complete.')).toBeTruthy();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
        expect(view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 8000 },
    );
    view.unmount();
  }, 30000);
});
