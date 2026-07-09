/**
 * Single source of truth for the chat list's auto-scroll policy.
 *
 * Several reactive events want to move the message list on their own — a new
 * token arrives, a new message is appended, the keyboard opens, the content
 * resizes. The RULE for whether each is allowed lives here and nowhere else, so
 * the screen and the message-area component consult one policy instead of each
 * re-deriving it (and drifting).
 *
 * The accessibility fix lives in this policy: while a screen reader (TalkBack /
 * VoiceOver) is active, any list behaviour that moves the viewport also moves
 * the reader's focus anchor, so the reader jumps around the conversation during
 * streaming. Such behaviours are therefore vetoed when a screen reader is on.
 * Screen-reader state is passed in as DATA (a capability flag), never branched
 * on per platform.
 */
export interface AutoScrollConditions {
  isNearBottom: boolean;
  screenReaderEnabled: boolean;
}

/**
 * Whether a focus-moving list behaviour is allowed at all right now. Covers both
 * imperative auto-scroll and the `maintainVisibleContentPosition` re-anchor — a
 * screen reader vetoes every one of them.
 */
export const focusMovingScrollAllowed = (screenReaderEnabled: boolean): boolean =>
  !screenReaderEnabled;

/**
 * Whether the list should follow the stream to the bottom on new content. This
 * additionally requires the user to be near the bottom already, so a user who
 * scrolled up to read history is not yanked back down.
 */
export const shouldFollowStream = ({ isNearBottom, screenReaderEnabled }: AutoScrollConditions): boolean =>
  focusMovingScrollAllowed(screenReaderEnabled) && isNearBottom;
