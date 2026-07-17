/** P2 #49 — Chat Settings restores text-generation defaults through the UI. */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('P2 reset text settings journey', () => {
  it('returns a changed LiteRT temperature to its default', async () => {
    const h = await setupChatScreen({ engine: 'litert' });
    h.render();

    h.rtl.fireEvent.press(h.view!.getByTestId('chat-settings-icon'));
    h.rtl.fireEvent.press(
      await h.rtl.waitFor(() => h.view!.getByText('TEXT GENERATION')),
    );
    h.rtl.fireEvent.press(
      h.view!.getByTestId('setting-liteRTTemperature-value-button'),
    );
    const input = h.view!.getByTestId('setting-liteRTTemperature-input');
    h.rtl.fireEvent.changeText(input, '1.25');
    h.rtl.fireEvent(input, 'submitEditing');
    await h.rtl.waitFor(() =>
      expect(
        h.view!.getByTestId('setting-liteRTTemperature-value').props.children,
      ).toBe('1.25'),
    );

    h.rtl.fireEvent.press(h.view!.getByText('Reset to Defaults'));
    await h.rtl.waitFor(() =>
      expect(
        h.view!.getByTestId('setting-liteRTTemperature-value').props.children,
      ).toBe('0.70'),
    );
    h.view!.unmount();
  });
});
