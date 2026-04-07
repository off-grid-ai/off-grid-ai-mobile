import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ChatMessage } from '../../components';
import { AudioMessageBubble } from '../../components/AudioMessageBubble';
import { TTSButton } from '../../components/TTSButton';
import { AnimatedEntry } from '../../components/AnimatedEntry';
import { stripControlTokens } from '../../utils/messageContent';
import { Message } from '../../types';
import '../../types/tts';
import { ChatMessageItem } from './useChatScreen';

type MessageRendererProps = {
  item: Message | ChatMessageItem;
  index: number;
  displayMessagesLength: number;
  animateLastN: number;
  imageModelLoaded: boolean;
  isStreaming: boolean;
  isGeneratingImage: boolean;
  showGenerationDetails: boolean;
  onCopy: (content: string) => void;
  onRetry: (message: Message) => void;
  onEdit: (message: Message, newContent: string) => void;
  onGenerateImage: (prompt: string) => void;
  onImagePress: (uri: string) => void;
};

type AudioBubbleProps = {
  messageId: string;
  audioPath: string;
  waveformData: number[];
  durationSeconds: number;
  transcript: string;
};

function buildAudioBubbleProps(msg: Message): AudioBubbleProps {
  return {
    messageId: msg.id,
    audioPath: msg.audioPath ?? '',
    waveformData: msg.waveformData ?? [],
    durationSeconds: msg.audioDurationSeconds ?? 0,
    transcript: stripControlTokens(msg.content),
  };
}

export const MessageRenderer: React.FC<MessageRendererProps> = ({
  item,
  index,
  displayMessagesLength,
  animateLastN,
  imageModelLoaded,
  isStreaming,
  isGeneratingImage,
  showGenerationDetails,
  onCopy,
  onRetry,
  onEdit,
  onGenerateImage,
  onImagePress,
}) => {
  const msg = item as Message;
  const animateEntry = animateLastN > 0 && index >= displayMessagesLength - animateLastN;
  const isStreamingThis = item.id === 'streaming';

  // User voice message: always show as audio bubble (playable in both chat and audio mode)
  if (msg.role === 'user') {
    const audioAtt = msg.attachments?.find((a) => a.type === 'audio');
    if (audioAtt) {
      const bubble = (
        <View style={audioStyles.userContainer}>
          <AudioMessageBubble
            messageId={msg.id}
            audioPath={audioAtt.uri}
            waveformData={[]}
            durationSeconds={audioAtt.audioDurationSeconds ?? 0}
            transcript={msg.content}
            isUser
          />
        </View>
      );
      return animateEntry ? <AnimatedEntry index={0}>{bubble}</AnimatedEntry> : bubble;
    }
  }

  // Audio Mode: assistant messages that were generated in audio mode appear as audio bubbles
  if (msg.role === 'assistant' && msg.isAudioModeMessage && !msg.isSystemInfo && !msg.toolCalls?.length) {
    const bubble = (
      <View style={audioStyles.assistantContainer}>
        <AudioMessageBubble {...buildAudioBubbleProps(msg)} />
      </View>
    );
    return animateEntry ? <AnimatedEntry index={0}>{bubble}</AnimatedEntry> : bubble;
  }

  // Chat Mode: TTSButton lives in the meta row via metaExtra prop
  const isPlainAssistant = msg.role === 'assistant' && !msg.isSystemInfo && !msg.toolCalls?.length;
  const ttsMeta = isPlainAssistant && !isStreamingThis
    ? <TTSButton text={stripControlTokens(msg.content)} messageId={msg.id} />
    : undefined;

  return (
    <ChatMessage
      message={msg}
      isStreaming={isStreamingThis}
      onCopy={onCopy}
      onRetry={onRetry}
      onEdit={onEdit}
      onGenerateImage={onGenerateImage}
      onImagePress={onImagePress}
      canGenerateImage={imageModelLoaded && !isStreaming && !isGeneratingImage}
      showGenerationDetails={showGenerationDetails}
      animateEntry={animateEntry}
      metaExtra={ttsMeta}
    />
  );
};

// Matches the horizontal padding of ChatMessage so audio bubbles align with text bubbles
const audioStyles = StyleSheet.create({
  userContainer: {
    paddingRight: 16,
    marginVertical: 8,
    alignItems: 'flex-end',
  },
  assistantContainer: {
    paddingHorizontal: 16,
    marginVertical: 8,
    alignItems: 'flex-start',
  },
});
