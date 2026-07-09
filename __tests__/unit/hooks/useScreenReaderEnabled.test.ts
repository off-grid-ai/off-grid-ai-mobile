/**
 * useScreenReaderEnabled — thin projection of AccessibilityInfo. Drives the REAL
 * hook against a mocked native boundary (AccessibilityInfo) and asserts the
 * observable outcome: the initial query result, live updates via the
 * screenReaderChanged event, and listener cleanup on unmount.
 */
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { useScreenReaderEnabled } from '../../../src/hooks/useScreenReaderEnabled';

type ChangeHandler = (enabled: boolean) => void;

describe('useScreenReaderEnabled', () => {
  let changeHandler: ChangeHandler | undefined;
  let remove: jest.Mock;

  beforeEach(() => {
    changeHandler = undefined;
    remove = jest.fn();
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockImplementation(((event: string, handler: ChangeHandler) => {
        if (event === 'screenReaderChanged') changeHandler = handler;
        return { remove };
      }) as unknown as typeof AccessibilityInfo.addEventListener);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reflects the initial screen-reader state from the native query', async () => {
    (AccessibilityInfo.isScreenReaderEnabled as jest.Mock).mockResolvedValue(true);
    const { result } = renderHook(() => useScreenReaderEnabled());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('defaults to false before the async query resolves', () => {
    const { result } = renderHook(() => useScreenReaderEnabled());
    expect(result.current).toBe(false);
  });

  it('updates live when the screen reader is toggled on and off', async () => {
    const { result } = renderHook(() => useScreenReaderEnabled());
    await waitFor(() => expect(changeHandler).toBeDefined());

    act(() => changeHandler!(true));
    expect(result.current).toBe(true);

    act(() => changeHandler!(false));
    expect(result.current).toBe(false);
  });

  it('removes the listener on unmount', async () => {
    const { unmount } = renderHook(() => useScreenReaderEnabled());
    await waitFor(() => expect(changeHandler).toBeDefined());
    unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
