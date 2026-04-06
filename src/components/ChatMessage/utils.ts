import { stripControlTokens } from '../../utils/messageContent';
import type { Message } from '../../types';
import type { ParsedContent } from './types';

/**
 * Parse content that may contain thinking/reasoning sections.
 * Handles three formats:
 * 1. <think>...</think> tags (DeepSeek-style, used by llama models with thinking enabled)
 * 2. <|channel>thought\n...<channel|> (Gemma 4)
 * 3. <|channel|>analysis<|message|>...<|channel|>final<|message|> (Qwen and similar models)
 */
export function parseThinkingContent(content: string): ParsedContent {
  // Gemma 4 thinking format: <|channel>thought\n[thinking]<channel|>[response]
  // Note asymmetric tags: <|channel> opens (with channel name 'thought'), <channel|> closes.
  const gemmaOpenMatch = content.match(/<\|channel>thought\n/i);
  const gemmaCloseMatch = content.match(/<channel\|>/i);

  if (gemmaOpenMatch) {
    const thinkStart = gemmaOpenMatch.index! + gemmaOpenMatch[0].length;
    if (gemmaCloseMatch && gemmaCloseMatch.index! >= thinkStart) {
      const thinkEnd = gemmaCloseMatch.index!;
      return {
        thinking: content.slice(thinkStart, thinkEnd).trim(),
        response: content.slice(thinkEnd + gemmaCloseMatch[0].length).trim(),
        isThinkingComplete: true,
      };
    }
    // Still streaming — thinking not yet closed
    return {
      thinking: content.slice(thinkStart).trim(),
      response: '',
      isThinkingComplete: false,
    };
  }

  // Check for channel-based thinking format
  // Format: <|channel|>analysis<|message|>[thinking content]<|channel|>final<|message|>[response]
  const channelAnalysisMatch = content.match(/<\|channel\|>analysis<\|message\|>/i);
  const channelFinalMatch = content.match(/<\|channel\|>final<\|message\|>/i);

  if (channelAnalysisMatch) {
    const analysisStart = channelAnalysisMatch.index! + channelAnalysisMatch[0].length;

    if (channelFinalMatch) {
      // We have both analysis and final markers
      const finalStart = channelFinalMatch.index!;

      // Guard against out-of-order markers (final before analysis)
      if (finalStart < analysisStart) {
        return {
          thinking: content.slice(analysisStart).trim(),
          response: '',
          isThinkingComplete: false,
        };
      }

      const thinkingContent = content.slice(analysisStart, finalStart).trim();
      const responseContent = content.slice(finalStart + channelFinalMatch[0].length).trim();

      return {
        thinking: thinkingContent,
        response: responseContent,
        isThinkingComplete: true,
      };
    }

    // Only analysis marker - thinking is still in progress
    const thinkingContent = content.slice(analysisStart).trim();
    return {
      thinking: thinkingContent,
      response: '',
      isThinkingComplete: false,
    };
  }

  // Fall back to <think></think> format
  const thinkStartMatch = content.match(/<think>/i);
  const thinkEndMatch = content.match(/<\/think>/i);

  if (!thinkStartMatch) {
    // Handle  HLSL without HLSL — llama.rn Jinja template may consume
    // the opening HLSL tag while leaving thinking text + HLSL as tokens
    if (thinkEndMatch) {
      const thinkEnd = thinkEndMatch.index!;
      const thinkingContent = content.slice(0, thinkEnd).trim();
      const responseContent = content.slice(thinkEnd + thinkEndMatch[0].length).trim();
      if (thinkingContent) {
        return {
          thinking: thinkingContent,
          response: responseContent,
          isThinkingComplete: true,
        };
      }
    }
    return { thinking: null, response: content, isThinkingComplete: true };
  }

  const thinkStart = thinkStartMatch.index! + thinkStartMatch[0].length;

  if (!thinkEndMatch) {
    const thinkingContent = content.slice(thinkStart);
    return {
      thinking: thinkingContent,
      response: '',
      isThinkingComplete: false,
    };
  }

  const thinkEnd = thinkEndMatch.index!;
  let thinkingContent = content.slice(thinkStart, thinkEnd).trim();
  const responseContent = content.slice(thinkEnd + thinkEndMatch[0].length).trim();

  let thinkingLabel: string | undefined;
  const labelMatch = thinkingContent.match(/^__LABEL:(.+?)__\n*/);
  if (labelMatch) {
    thinkingLabel = labelMatch[1];
    thinkingContent = thinkingContent.slice(labelMatch[0].length).trim();
  }

  return {
    thinking: thinkingContent,
    response: responseContent,
    isThinkingComplete: true,
    thinkingLabel,
  };
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

export function buildMessageData(message: Message): { displayContent: string; parsedContent: ParsedContent } {
  // Use reasoningContent from llama.rn if available
  if (message.reasoningContent) {
    const displayContent = message.role === 'assistant'
      ? stripControlTokens(message.content).replaceAll(/<\/?think>/gi, '').trim()
      : message.content;
    return {
      displayContent,
      parsedContent: { thinking: message.reasoningContent, response: displayContent, isThinkingComplete: true },
    };
  }

  // Parse thinking content from raw message (before stripping control tokens)
  // This handles both HLSL HLSL and <|channel|>analysis<|message|> formats
  let parsedContent: ParsedContent;
  if (message.role === 'assistant') {
    parsedContent = parseThinkingContent(message.content);
  } else {
    parsedContent = { thinking: null, response: message.content, isThinkingComplete: true };
  }

  // Strip control tokens for display
  const displayContent = parsedContent.response
    ? stripControlTokens(parsedContent.response)
    : stripControlTokens(message.content);

  return { displayContent, parsedContent };
}