import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Tracks whether a screen reader (TalkBack on Android, VoiceOver on iOS) is
 * active. This is a device CAPABILITY expressed as data — a single source of
 * truth the UI reads to decide behaviour, never a `Platform.OS` branch.
 *
 * Why it exists: while a reply streams, the chat list auto-scrolls to the
 * bottom on every token and re-anchors with `maintainVisibleContentPosition`.
 * For a sighted user that keeps the latest text in view; for a screen-reader
 * user it repeatedly steals the accessibility focus, so the reader jumps from
 * wherever they parked it to the bottom of the conversation. Callers gate those
 * auto-scroll side-effects on this flag so the reader's focus is left alone.
 *
 * Both platforms satisfy the same `AccessibilityInfo` contract (initial query +
 * `screenReaderChanged` event), so one hook guards iOS and Android together.
 */
export const useScreenReaderEnabled = (): boolean => {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isScreenReaderEnabled().then((value) => {
      if (mounted) setEnabled(value);
    });
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', (value: boolean) => {
      setEnabled(value);
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return enabled;
};
