import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { useTTSStore } from '../../stores/ttsStore';
import { KOKORO_VOICES } from '../../constants/kokoroModels';
import type { KokoroVoiceId } from '../../constants/kokoroModels';
import { TYPOGRAPHY, SPACING } from '../../constants';
import type { ThemeColors, ThemeShadows } from '../../theme';

const WAVEFORM_BARS = 28;
const SPEED_STEPS: number[] = [0.5, 1.0, 1.5, 2.0];

interface AudioMessageBubbleProps {
  messageId: string;
  audioPath: string;
  waveformData: number[];
  durationSeconds: number;
  /** Optional plain-text transcript to show when user expands */
  transcript?: string;
  /** True for user-sent voice recordings (right-aligned) */
  isUser?: boolean;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function subsample(data: number[], count: number): number[] {
  if (data.length === 0) {
    // Generate a visible placeholder waveform pattern
    return Array.from({ length: count }, (_, i) => 0.25 + 0.25 * Math.sin((i / count) * Math.PI * 4));
  }
  const step = data.length / count;
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    result.push(data[Math.floor(i * step)] ?? 0.1);
  }
  return result;
}

function normalize(data: number[]): number[] {
  const max = Math.max(...data, 0.001);
  return data.map((v) => v / max);
}

const WaveformBars: React.FC<{
  data: number[];
  colors: ThemeColors;
}> = ({ data, colors }) => {
  const bars = normalize(subsample(data, WAVEFORM_BARS));
  return (
    <View style={barStyles.container}>
      {bars.map((amp, i) => {
        const height = Math.max(6, Math.round(amp * 28));
        return (
          <View
            key={i}
            style={[
              barStyles.bar,
              {
                height,
                backgroundColor: colors.primary,
                opacity: 0.6 + amp * 0.4,
              },
            ]}
          />
        );
      })}
    </View>
  );
};

const barStyles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 32,
    overflow: 'hidden',
  },
  bar: {
    width: 3,
    borderRadius: 2,
  },
});

export const AudioMessageBubble: React.FC<AudioMessageBubbleProps> = ({
  messageId,
  audioPath,
  waveformData,
  durationSeconds,
  transcript,
  isUser = false,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { isSpeaking, currentMessageId, settings, playMessage, stopPlayback, speak, updateSettings } =
    useTTSStore();

  const [showTranscript, setShowTranscript] = useState(false);
  const initialSpeedIdx = SPEED_STEPS.indexOf(settings.speed);
  const [speedIndex, setSpeedIndex] = useState(initialSpeedIdx >= 0 ? initialSpeedIdx : 1);

  const isThisPlaying = isSpeaking && currentMessageId === messageId;

  const kokoroVoiceId = useTTSStore((s) => s.settings.kokoroVoiceId);
  const currentVoiceIdx = KOKORO_VOICES.findIndex((v) => v.id === kokoroVoiceId);
  const currentVoice = KOKORO_VOICES[currentVoiceIdx >= 0 ? currentVoiceIdx : 0];

  const handlePlayPause = useCallback(() => {
    if (isThisPlaying) {
      stopPlayback();
      return;
    }
    if (audioPath) {
      playMessage(messageId, audioPath);
    } else {
      speak(transcript ?? '', messageId);
    }
  }, [isThisPlaying, stopPlayback, playMessage, speak, messageId, audioPath, transcript]);

  const handleSpeedCycle = useCallback(() => {
    const next = (speedIndex + 1) % SPEED_STEPS.length;
    setSpeedIndex(next);
    updateSettings({ speed: SPEED_STEPS[next] });
  }, [speedIndex, updateSettings]);

  const handleVoiceCycle = useCallback(() => {
    const idx = KOKORO_VOICES.findIndex((v) => v.id === kokoroVoiceId);
    const next = (idx + 1) % KOKORO_VOICES.length;
    updateSettings({ kokoroVoiceId: KOKORO_VOICES[next].id as KokoroVoiceId });
  }, [kokoroVoiceId, updateSettings]);

  const speedChip = (
    <TouchableOpacity
      onPress={handleSpeedCycle}
      style={styles.speedChip}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={styles.speedText}>{SPEED_STEPS[speedIndex]}x</Text>
    </TouchableOpacity>
  );

  const voiceChip = !isUser ? (
    <TouchableOpacity
      onPress={handleVoiceCycle}
      style={styles.speedChip}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={styles.speedText}>{currentVoice.label}</Text>
    </TouchableOpacity>
  ) : null;

  const playButton = (
    <TouchableOpacity
      onPress={handlePlayPause}
      style={styles.playButton}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Icon
        name={isThisPlaying ? 'pause' : 'play'}
        size={16}
        color={colors.primary}
      />
    </TouchableOpacity>
  );

  const durationText = (
    <Text style={styles.duration}>{formatDuration(durationSeconds)}</Text>
  );

  return (
    <View style={[styles.bubble, isUser && styles.bubbleUser]} testID={`audio-bubble-${messageId}`}>
      {/* Playback row */}
      <View style={styles.playRow}>
        {isUser ? (
          <>
            {speedChip}
            {durationText}
            <WaveformBars data={waveformData} colors={colors} />
            {playButton}
          </>
        ) : (
          <>
            {playButton}
            <WaveformBars data={waveformData} colors={colors} />
            {durationText}
            {speedChip}
            {voiceChip}
          </>
        )}
      </View>

      {/* Transcript toggle */}
      {transcript ? (
        <TouchableOpacity
          onPress={() => setShowTranscript((v) => !v)}
          style={styles.transcriptToggle}
        >
          <Text style={styles.transcriptToggleText}>
            {showTranscript ? 'Hide transcript' : 'Show transcript'}
          </Text>
          <Icon
            name={showTranscript ? 'chevron-up' : 'chevron-down'}
            size={11}
            color={colors.textMuted}
          />
        </TouchableOpacity>
      ) : null}

      {showTranscript && transcript ? (
        <Text style={styles.transcript}>{transcript}</Text>
      ) : null}
    </View>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  bubble: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: SPACING.md,
    maxWidth: '88%' as const,
    minWidth: 220,
    alignSelf: 'flex-start' as const,
    gap: SPACING.sm,
    overflow: 'hidden' as const,
  },
  bubbleUser: {
    alignSelf: 'flex-end' as const,
    backgroundColor: `${colors.primary}18`,
    borderColor: `${colors.primary}40`,
  },
  playRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
  },
  playButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: `${colors.primary}20`,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  duration: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    minWidth: 32,
    textAlign: 'right' as const,
  },
  speedChip: {
    backgroundColor: colors.surfaceLight,
    borderRadius: 6,
    paddingHorizontal: SPACING.xs,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  speedText: {
    ...TYPOGRAPHY.metaSmall,
    color: colors.textSecondary,
  },
  transcriptToggle: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.xs,
  },
  transcriptToggleText: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
  },
  transcript: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    lineHeight: 18,
  },
});
