/**
 * ChatInputModeToggle tests
 *
 * The pro-only inline Chat→Audio interface toggle rendered in the chat-input
 * pill row. Verifies:
 *  - when no audio engine is ready → routes to the TTS settings screen
 *  - when ready → flips interfaceMode inline (chat→audio)
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

jest.mock('@offgrid/core/utils/haptics', () => ({
  triggerHaptic: jest.fn(),
}));

import { ChatInputModeToggle } from '../../../pro/audio/ui/ChatInputModeToggle';
import { useTTSStore } from '../../../pro/audio/ttsStore';

const styles = { pillIconButton: {} };

const setReady = (ready: boolean, mode: 'chat' | 'audio' = 'chat') => {
  useTTSStore.setState((s) => ({
    isReady: ready,
    settings: { ...s.settings, interfaceMode: mode },
  }));
};

describe('ChatInputModeToggle', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    setReady(false, 'chat');
  });

  it('routes to TTS settings when no audio engine is ready', () => {
    setReady(false);
    const { getByTestId } = render(<ChatInputModeToggle styles={styles} />);

    fireEvent.press(getByTestId('chat-input-mode-toggle'));

    expect(mockNavigate).toHaveBeenCalledWith('TTSSettings');
    // Must NOT switch into a broken Audio Mode.
    expect(useTTSStore.getState().settings.interfaceMode).toBe('chat');
  });

  it('flips interfaceMode to audio inline when the engine is ready', () => {
    setReady(true, 'chat');
    const { getByTestId } = render(<ChatInputModeToggle styles={styles} />);

    fireEvent.press(getByTestId('chat-input-mode-toggle'));

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(useTTSStore.getState().settings.interfaceMode).toBe('audio');
  });

  it('does not fire when disabled', () => {
    setReady(true, 'chat');
    const { getByTestId } = render(<ChatInputModeToggle styles={styles} disabled />);

    fireEvent.press(getByTestId('chat-input-mode-toggle'));

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(useTTSStore.getState().settings.interfaceMode).toBe('chat');
  });
});
