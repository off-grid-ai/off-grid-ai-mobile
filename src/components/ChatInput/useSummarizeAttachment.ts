import { useState } from 'react';
import { MediaAttachment } from '../../types';
import { transcriptSummarizer } from '../../services';
import { useChatStore, useAppStore } from '../../stores';
import logger from '../../utils/logger';

/** Throttle for streaming the summary into the message (~20 paints/sec). */
const STREAM_FLUSH_MS = 50;

/** mm:ss for a millisecond offset, used to label an attached transcript range. */
function fmtClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Summarize an attached document/transcript that is too large to fit the model's
 * context window. Posts a user message ("Summarize <file>") and an assistant
 * message, then streams progress into that assistant message (part i of N,
 * combining) before replacing it with the final summary. Self-contained: reads
 * the active conversation + model from the global stores, so it does not need
 * props threaded down from the chat screen.
 */
export function useSummarizeAttachment() {
  const [summarizingId, setSummarizingId] = useState<string | null>(null);

  const handleSummarize = async (attachment: MediaAttachment): Promise<void> => {
    if (summarizingId) return;
    const text = attachment.textContent?.trim();
    if (!text) return;

    const chat = useChatStore.getState();
    let conversationId = chat.activeConversationId;
    if (!conversationId) {
      const modelId = useAppStore.getState().activeModelId;
      if (!modelId) return; // no model loaded - nothing to summarize with
      conversationId = chat.createConversation(modelId);
      chat.setActiveConversation(conversationId);
    }

    const label = attachment.fileName || 'transcript';
    const range =
      attachment.transcriptStartMs != null && attachment.transcriptEndMs != null
        ? ` (${fmtClock(attachment.transcriptStartMs)} to ${fmtClock(attachment.transcriptEndMs)})`
        : '';
    chat.addMessage(conversationId, { role: 'user', content: `Summarize ${label}${range}` });
    const placeholder = chat.addMessage(conversationId, { role: 'assistant', content: 'Starting...' });

    setSummarizingId(attachment.id);
    // Stream the work in place. The map phase streams each part as it is written
    // (so a multi-chunk run shows text from part 1, not a static counter for
    // minutes), then the final combine pass restreams the answer over the top.
    // updateMessageContent rebuilds the conversations tree on every call, so we
    // flush on a ~50ms timer (matching the main generation loop) rather than per
    // token, otherwise the JS thread saturates and the UI only paints at the end.
    let uiPhase: 'map' | 'final' = 'map';
    let total = 0;
    let current = 0;
    const doneParts: string[] = [];
    let curPart = '';
    let finalText = '';
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const compose = (): string => {
      if (uiPhase === 'final') return finalText || 'Combining the parts...';
      const parts = [...doneParts, curPart].filter((s) => s.trim());
      const header = total > 1 ? `Summarizing part ${current} of ${total}\n\n` : 'Summarizing...\n\n';
      return parts.length ? header + parts.join('\n\n') : header.trim();
    };
    const flush = () => {
      flushTimer = null;
      useChatStore.getState().updateMessageContent(conversationId!, placeholder.id, compose());
    };
    const scheduleFlush = () => { if (!flushTimer) flushTimer = setTimeout(flush, STREAM_FLUSH_MS); };

    try {
      const summary = await transcriptSummarizer.summarize(text, {
        onProgress: (p) => {
          if (p.phase === 'chunking') {
            total = p.total;
          } else if (p.phase === 'mapping') {
            if (p.total <= 1) {
              uiPhase = 'final'; // single pass: the streamed text is the answer
            } else {
              if (curPart.trim()) doneParts.push(curPart.trim());
              curPart = '';
              total = p.total;
              current = p.current;
            }
          } else if (p.phase === 'combining') {
            if (curPart.trim()) doneParts.push(curPart.trim());
            curPart = '';
            uiPhase = 'final';
            finalText = '';
          }
          scheduleFlush();
        },
        onToken: (delta) => {
          if (uiPhase === 'final') finalText += delta;
          else curPart += delta;
          scheduleFlush();
        },
      });
      if (flushTimer) clearTimeout(flushTimer);
      // Final trimmed summary (streamed text may have leading/trailing space).
      useChatStore.getState().updateMessageContent(conversationId, placeholder.id, summary);
    } catch (e) {
      if (flushTimer) clearTimeout(flushTimer);
      const msg = e instanceof Error ? e.message : 'Summarization failed';
      useChatStore.getState().updateMessageContent(
        conversationId,
        placeholder.id,
        `Could not summarize this transcript.\n\n${msg}`,
      );
      logger.warn('[useSummarizeAttachment] failed:', e);
    } finally {
      setSummarizingId(null);
    }
  };

  return { summarizingId, handleSummarize };
}
