/**
 * T056 / DEV-B13 — a generation that ends in ERROR must clear the loading state and show the error; it must
 * NOT leave the UI spinning forever.
 *
 * Device (B13, part2): a generation that ended reason=error (vision decode fail) left the UI spinning
 * indefinitely and the user saw no error — a dead-end with no way forward.
 *
 * User behavior, real gestures: litert model active, send a message HELD in-flight so the loading state is
 * genuinely on screen (the stop control renders), THEN the native runtime fails it (device-shaped
 * litert_error). Observed transition — spinner ON → cleared — so the assertion is real, not trivially true.
 *
 * Falsified: breaking chatStore.clearStreamingMessage (the isStreaming/isThinking reset the error path calls)
 * makes this go RED (stop control persists). GREEN on HEAD ⇒ B13 fixed on the local path.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T056 (rendered) — generation error clears the spinner + surfaces the error (DEV-B13)', () => {
  it('clears the generating STOP control and shows the error after a failed generation', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android' });
    h.render();

    // Send with the generation HELD in-flight so the loading state truly renders (a stop control appears).
    h.boundary.litert.scriptHang();
    await h.tapSend('describe this image');
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('stop-button')).not.toBeNull(); }, { timeout: 4000 });

    // The in-flight generation now fails (device-shaped litert_error).
    h.boundary.litertEvents.emit('litert_error', 'Failed to evaluate chunks');

    // The error reached the user...
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Failed to evaluate chunks/)).not.toBeNull(); }, { timeout: 4000 });
    // ...and the generating STOP control CLEARED — the input is usable again, not spinning forever.
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('stop-button')).toBeNull(); }, { timeout: 4000 });
  });
});
