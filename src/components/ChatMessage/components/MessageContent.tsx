import React, { useEffect } from 'react';
import { View, Text } from 'react-native';
import { ThinkingIndicator } from '../../ThinkingIndicator';
import { MarkdownText } from '../../MarkdownText';
import { BlinkingCursor } from './BlinkingCursor';
import { ThinkingBlock } from './ThinkingBlock';
import type { ParsedContent } from '../types';
import logger from '../../../utils/logger';

interface MessageContentProps {
  isUser: boolean;
  isThinking?: boolean;
  content: string;
  isStreaming?: boolean;
  parsedContent: ParsedContent;
  showThinking: boolean;
  onToggleThinking: () => void;
  styles: any;
}

export function MessageContent({
  isUser,
  isThinking,
  content,
  isStreaming,
  parsedContent,
  showThinking,
  onToggleThinking,
  styles,
}: Readonly<MessageContentProps>) {
  useEffect(() => {
    logger.log(
      `[Structure] MessageContent mounted — role=${isUser ? 'user' : 'assistant'} isThinking=${isThinking} isStreaming=${isStreaming} contentLen=${content?.length ?? 0} hasThinking=${!!parsedContent.thinking} hasResponse=${!!parsedContent.response}`
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isThinking) {
    return (
      <View testID="thinking-indicator">
        <ThinkingIndicator text={content} />
      </View>
    );
  }

  if (!content) {
    if (isStreaming) {
      return (
        <Text testID="message-text" style={[styles.text, styles.assistantText]}>
          <BlinkingCursor />
        </Text>
      );
    }
    return null;
  }

  return (
    <View>
      {!!parsedContent.thinking && (
        <ThinkingBlock
          parsedContent={parsedContent}
          showThinking={showThinking}
          onToggle={onToggleThinking}
          styles={styles}
        />
      )}

      {(() => {
        if (parsedContent.response) {
          if (isUser) {
            return (
              <Text
                testID="message-text"
                style={[styles.text, styles.userText]}
                selectable
              >
                {parsedContent.response}
              </Text>
            );
          }
          return (
            <View
              testID="message-text"
              onStartShouldSetResponder={() => {
                logger.log('[Touch] assistant bubble View — onStartShouldSetResponder fired (returning false so children can claim)');
                return false;
              }}
              onMoveShouldSetResponder={() => {
                logger.log('[Touch] assistant bubble View — onMoveShouldSetResponder fired');
                return false;
              }}
            >
              <MarkdownText>{parsedContent.response}</MarkdownText>
              {isStreaming && <BlinkingCursor />}
            </View>
          );
        }
        if (isStreaming && !parsedContent.isThinkingComplete) {
          return (
            <View testID="streaming-thinking-hint" style={styles.streamingThinkingHint}>
              <ThinkingIndicator />
            </View>
          );
        }
        if (isStreaming) {
          return (
            <Text testID="message-text" style={[styles.text, styles.assistantText]}>
              <BlinkingCursor />
            </Text>
          );
        }
        return null;
      })()}
    </View>
  );
}
