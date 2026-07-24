/**
 * Chat Attachment Inbox
 *
 * A one-shot hand-off for seeding the chat composer with an attachment created
 * elsewhere (e.g. the Pro recorder's "Attach to chat", which builds a transcript
 * document and navigates to the Chat screen). The composer consumes the pending
 * attachments once on mount, then clears them.
 *
 * Kept as a tiny module-level store (not a route param) so a large transcript
 * body never has to be serialized through navigation, and so Pro can hand off to
 * core without core importing anything from Pro.
 */
import { MediaAttachment } from '../types';

let pending: MediaAttachment[] = [];

/** Queue attachments to seed the next chat composer mount. Replaces any pending. */
export function setPendingChatAttachments(attachments: MediaAttachment[]): void {
  pending = attachments;
}

/** Return and clear the pending attachments (empty array if none). */
export function takePendingChatAttachments(): MediaAttachment[] {
  const taken = pending;
  pending = [];
  return taken;
}
