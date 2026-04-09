import React, { useEffect, useState } from 'react';

let _attachmentIdSeq = 0;
const nextAttachmentId = () => `${Date.now()}-${(++_attachmentIdSeq).toString(36)}`;
import { ActionSheetIOS, Platform, View, Text, Image, ScrollView, TouchableOpacity } from 'react-native';
import { launchImageLibrary, launchCamera, Asset } from 'react-native-image-picker';
import { pick, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { MediaAttachment } from '../../types';
import { documentService } from '../../services/documentService';
import { AlertState, showAlert, hideAlert } from '../CustomAlert';
import { createStyles } from './styles';
import logger from '../../utils/logger';

// ─── useAttachments hook ──────────────────────────────────────────────────────
let pickerRequestSeq = 0;
type ActivePickerRequest = { id: number; source: string; startedAt: number };

const PICKER_WATCHDOG_MS = 10000;
const PICKER_STALE_RESET_MS = 15000;
let globalPickerRequest: ActivePickerRequest | null = null;
let globalPickerWatchdog: ReturnType<typeof setTimeout> | null = null;
const pickerStateListeners = new Set<(request: ActivePickerRequest | null) => void>();

const notifyPickerState = () => {
  pickerStateListeners.forEach(listener => listener(globalPickerRequest));
};

const subscribePickerState = (listener: (request: ActivePickerRequest | null) => void) => {
  pickerStateListeners.add(listener);
  listener(globalPickerRequest);
  return () => pickerStateListeners.delete(listener);
};

const startPickerWatchdog = (request: ActivePickerRequest) => {
  if (globalPickerWatchdog) clearTimeout(globalPickerWatchdog);
  globalPickerWatchdog = setTimeout(() => {
    if (!globalPickerRequest || globalPickerRequest.id !== request.id) return;
    logger.warn('[ChatInput][Attachments]', 'picker-watchdog-timeout', {
      requestId: request.id,
      source: request.source,
      durationMs: Date.now() - request.startedAt,
    });
  }, PICKER_WATCHDOG_MS);
};

const clearPickerWatchdog = () => {
  if (globalPickerWatchdog) {
    clearTimeout(globalPickerWatchdog);
    globalPickerWatchdog = null;
  }
};

const resetGlobalPickerRequest = (reason: string) => {
  const staleRequest = globalPickerRequest;
  clearPickerWatchdog();
  globalPickerRequest = null;
  notifyPickerState();
  logger.warn('[ChatInput][Attachments]', 'picker-lock-reset', {
    reason,
    requestId: staleRequest?.id ?? null,
    source: staleRequest?.source ?? null,
    durationMs: staleRequest ? Date.now() - staleRequest.startedAt : null,
  });
};

export const __resetAttachmentPickerForTests = () => {
  clearPickerWatchdog();
  globalPickerRequest = null;
  notifyPickerState();
};

export function useAttachments(setAlertState: (state: AlertState) => void) {
  const [attachments, setAttachments] = useState<MediaAttachment[]>([]);
  const [isPickerActive, setIsPickerActive] = useState(Boolean(globalPickerRequest));

  useEffect(() => subscribePickerState((request) => {
    setIsPickerActive(Boolean(request));
  }), []);

  const runPicker = async (source: string, action: (requestId: number) => Promise<void>) => {
    if (globalPickerRequest) {
      const durationMs = Date.now() - globalPickerRequest.startedAt;
      if (durationMs >= PICKER_STALE_RESET_MS) {
        resetGlobalPickerRequest('stale-before-new-request');
      }
    }

    if (globalPickerRequest) {
      logger.warn('[ChatInput][Attachments]', 'picker-blocked-busy', {
        source,
        activeRequest: `${globalPickerRequest.source}#${globalPickerRequest.id}`,
        durationMs: Date.now() - globalPickerRequest.startedAt,
      });
      return;
    }
    const requestId = ++pickerRequestSeq;
    const startedAt = Date.now();
    const request = { id: requestId, source, startedAt };
    globalPickerRequest = request;
    notifyPickerState();
    startPickerWatchdog(request);
    try {
      await action(requestId);
    } finally {
      clearPickerWatchdog();
      if (globalPickerRequest?.id === requestId) {
        globalPickerRequest = null;
        notifyPickerState();
      }
    }
  };

  const addAttachments = (assets: Asset[]) => {
    const newAttachments: MediaAttachment[] = assets
      .filter(asset => asset.uri)
      .map(asset => ({
        id: nextAttachmentId(),
        type: 'image' as const,
        uri: asset.uri!,
        mimeType: asset.type,
        width: asset.width,
        height: asset.height,
        fileName: asset.fileName,
      }));
    setAttachments(prev => [...prev, ...newAttachments]);
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const pickFromLibrary = async () => {
    await runPicker('photo-library', async (requestId) => {
      try {
        const result = await launchImageLibrary({ mediaType: 'photo', quality: 0.8, maxWidth: 1024, maxHeight: 1024 });
        if (result.assets && result.assets.length > 0) addAttachments(result.assets);
      } catch (pickError) {
        logger.error('Error picking image:', pickError);
        logger.warn('[ChatInput][Attachments]', 'image-library-error', {
          requestId,
          error: pickError instanceof Error ? pickError.message : String(pickError),
        });
      }
    });
  };

  const pickFromCamera = async () => {
    await runPicker('camera', async (requestId) => {
      try {
        const result = await launchCamera({ mediaType: 'photo', quality: 0.8, maxWidth: 1024, maxHeight: 1024 });
        if (result.assets && result.assets.length > 0) addAttachments(result.assets);
      } catch (cameraError) {
        logger.error('Error taking photo:', cameraError);
        logger.warn('[ChatInput][Attachments]', 'camera-error', {
          requestId,
          error: cameraError instanceof Error ? cameraError.message : String(cameraError),
        });
      }
    });
  };

  const handlePickImage = () => {
    if (globalPickerRequest) {
      const durationMs = Date.now() - globalPickerRequest.startedAt;
      if (durationMs >= PICKER_STALE_RESET_MS) {
        resetGlobalPickerRequest('stale-before-image-alert');
      }
    }

    if (globalPickerRequest) {
      logger.warn('[ChatInput][Attachments]', 'image-alert-blocked-busy', {
        activeRequest: `${globalPickerRequest.source}#${globalPickerRequest.id}`,
        durationMs: Date.now() - globalPickerRequest.startedAt,
      });
      return;
    }
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Camera', 'Photo Library', 'Cancel'],
          cancelButtonIndex: 2,
        },
        (buttonIndex) => {
          if (buttonIndex === 0) {
            setTimeout(pickFromCamera, 300);
            return;
          }

          if (buttonIndex === 1) {
            setTimeout(pickFromLibrary, 300);
          }
        },
      );
      return;
    }
    setAlertState(showAlert(
      'Add Image',
      'Choose image source',
      [
        {
          text: 'Camera',
          onPress: () => {
            setAlertState(hideAlert());
            setTimeout(pickFromCamera, 300);
          },
        },
        {
          text: 'Photo Library',
          onPress: () => {
            setAlertState(hideAlert());
            setTimeout(pickFromLibrary, 300);
          },
        },
      ],
    ));
  };

  const handlePickDocument = async () => {
    await runPicker('document', async (requestId) => {
      try {
        const result = await pick({
          type: [types.allFiles],
          allowMultiSelection: false,
          presentationStyle: 'fullScreen',
        });
        const file = result[0];
        if (!file) return;
        const fileName = file.name || 'document';
        if (!documentService.isSupported(fileName)) {
          setAlertState(showAlert(
            'Unsupported File',
            `"${fileName}" is not supported. Supported types: txt, md, csv, json, pdf, and code files.`,
            [{ text: 'OK' }],
          ));
          return;
        }
        const attachment = await documentService.processDocumentFromPath(file.uri, fileName);
        if (attachment) setAttachments(prev => [...prev, attachment]);
      } catch (pickError: any) {
        if (isErrorWithCode(pickError) && pickError.code === errorCodes.OPERATION_CANCELED) return;
        logger.error('Error picking document:', pickError);
        logger.warn('[ChatInput][Attachments]', 'document-picker-error', {
          requestId,
          message: pickError?.message || null,
          code: pickError?.code || null,
        });
        setAlertState(showAlert('Error', pickError.message || 'Failed to read document', [{ text: 'OK' }]));
      }
    });
  };

  const clearAttachments = () => setAttachments([]);

  return { attachments, isPickerActive, removeAttachment, clearAttachments, handlePickImage, handlePickDocument };
}

// ─── AttachmentPreview component ─────────────────────────────────────────────

interface AttachmentPreviewProps {
  attachments: MediaAttachment[];
  onRemove: (id: string) => void;
}

export const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({ attachments, onRemove }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  if (attachments.length === 0) return null;

  return (
    <ScrollView
      testID="attachments-container"
      horizontal
      style={styles.attachmentsContainer}
      contentContainerStyle={styles.attachmentsContent}
      showsHorizontalScrollIndicator={false}
    >
      {attachments.map(attachment => (
        <View key={attachment.id} testID={`attachment-preview-${attachment.id}`} style={styles.attachmentPreview}>
          {attachment.type === 'image' ? (
            <Image
              testID={`attachment-image-${attachment.id}`}
              source={{ uri: attachment.uri }}
              style={styles.attachmentImage}
            />
          ) : (
            <View testID={`document-preview-${attachment.id}`} style={styles.documentPreview}>
              <Icon name="file-text" size={24} color={colors.primary} />
              <Text style={styles.documentName} numberOfLines={2}>
                {attachment.fileName || 'Document'}
              </Text>
            </View>
          )}
          <TouchableOpacity
            testID={`remove-attachment-${attachment.id}`}
            style={styles.removeAttachment}
            onPress={() => onRemove(attachment.id)}
          >
            <Text style={styles.removeAttachmentText}>&times;</Text>
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
};
