import type { RenderedAppJourney } from './appJourney';

export const REMOTE_SERVER_NAME = 'My LM Studio';
export const REMOTE_ENDPOINT = 'http://localhost:1234';
export const REMOTE_MODEL_ID = 'llama-3-8b';

/** Seed only the remote HTTP discovery boundary used by the real server form/store. */
export function installRemoteDiscoveryBoundary(): void {
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: REMOTE_MODEL_ID, object: 'model', owned_by: 'local' }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
    return new Response(JSON.stringify({}), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

/** Configure, save, select, and open a remote chat using only rendered App gestures. */
export async function openRemoteChatThroughApp(
  rtl: RenderedAppJourney['rtl'],
  view: RenderedAppJourney['view'],
): Promise<void> {
  rtl.fireEvent.press(view.getByTestId('settings-tab'));
  await rtl.waitFor(() =>
    expect(view.getByText('Remote Servers')).toBeTruthy(),
  );
  rtl.fireEvent.press(view.getByText('Remote Servers'));
  await rtl.waitFor(() =>
    expect(view.getByText('No Remote Servers')).toBeTruthy(),
  );

  rtl.fireEvent.press(view.getByText('Add Server'));
  rtl.fireEvent.changeText(
    await rtl.waitFor(() =>
      view.getByPlaceholderText('e.g., Off Grid AI Desktop'),
    ),
    REMOTE_SERVER_NAME,
  );
  rtl.fireEvent.changeText(
    view.getByPlaceholderText('http://192.168.1.50:7878'),
    REMOTE_ENDPOINT,
  );
  rtl.fireEvent.press(view.getByText('Test Connection'));
  await rtl.waitFor(() => expect(view.getByText(/Connected \(/)).toBeTruthy(), {
    timeout: 5000,
  });
  const addButtons = view.getAllByText('Add Server');
  rtl.fireEvent.press(addButtons[addButtons.length - 1]);
  await rtl.waitFor(() => {
    expect(view.getByText(REMOTE_SERVER_NAME)).toBeTruthy();
    expect(view.getByText('Connected')).toBeTruthy();
  });

  rtl.fireEvent.press(view.getByTestId('remote-servers-back-button'));
  await rtl.waitFor(() =>
    expect(view.getByTestId('settings-tab')).toBeTruthy(),
  );
  rtl.fireEvent.press(view.getByTestId('home-tab'));
  await rtl.waitFor(() => expect(view.getByTestId('home-screen')).toBeTruthy());
  rtl.fireEvent.press(view.getByTestId('browse-models-button'));
  await rtl.waitFor(() => {
    expect(view.getByText(REMOTE_SERVER_NAME)).toBeTruthy();
    expect(view.getByText(REMOTE_MODEL_ID)).toBeTruthy();
    expect(view.getByTestId('remote-model-item')).toBeTruthy();
  });
  rtl.fireEvent.press(view.getByTestId('remote-model-item'));
  await rtl.waitFor(
    () => expect(view.getByTestId('new-chat-button')).toBeTruthy(),
    { timeout: 5000 },
  );
  rtl.fireEvent.press(view.getByTestId('new-chat-button'));
  await rtl.waitFor(() => expect(view.getByTestId('chat-screen')).toBeTruthy());
}
