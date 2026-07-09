/**
 * autoScroll — the single source of truth for the chat list's focus-moving
 * behaviours. These are the invariants the TalkBack focus-jump fix depends on,
 * so both branches of every predicate are asserted (a gate is only proven by
 * its blocking branch, not its allow branch).
 */
import { focusMovingScrollAllowed, shouldFollowStream } from '../../../../src/screens/ChatScreen/autoScroll';

describe('focusMovingScrollAllowed', () => {
  it('allows focus-moving scroll when no screen reader is active', () => {
    expect(focusMovingScrollAllowed(false)).toBe(true);
  });

  it('vetoes focus-moving scroll while a screen reader is active', () => {
    // The regression: any auto-scroll steals the reader focus. Must be blocked.
    expect(focusMovingScrollAllowed(true)).toBe(false);
  });
});

describe('shouldFollowStream', () => {
  it('follows the stream when near the bottom and no screen reader', () => {
    expect(shouldFollowStream({ isNearBottom: true, screenReaderEnabled: false })).toBe(true);
  });

  it('does NOT follow when the user scrolled up (not near bottom)', () => {
    expect(shouldFollowStream({ isNearBottom: false, screenReaderEnabled: false })).toBe(false);
  });

  it('does NOT follow while a screen reader is active, even near the bottom', () => {
    // The exact TalkBack case: near-bottom would normally follow, but the
    // screen-reader veto wins so focus is left where the user parked it.
    expect(shouldFollowStream({ isNearBottom: true, screenReaderEnabled: true })).toBe(false);
  });

  it('does NOT follow when both conditions block', () => {
    expect(shouldFollowStream({ isNearBottom: false, screenReaderEnabled: true })).toBe(false);
  });
});
