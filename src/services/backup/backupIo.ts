import { Platform, PermissionsAndroid, Share } from 'react-native';
import RNFS from 'react-native-fs';
import {
  pick,
  isErrorWithCode,
  errorCodes,
} from '@react-native-documents/picker';
import type { BackupSink } from '@offgrid/sync/portable';
import { resolvePickedFileUri } from '../../utils/resolvePickedFileUri';
import logger from '../../utils/logger';

/** How a written backup file was delivered to the user. */
export type DeliveryResult =
  | { method: 'shared' }
  | { method: 'saved'; location: string };

/**
 * The file boundary for backup/restore — the ONE place that touches the share
 * sheet and the document picker. It implements the engine's BackupSink over a
 * finished bundle FILE (a .zip the archive port already wrote): deliverFile
 * hands it to the user, pickFile returns a readable local path to an imported
 * one. The genuine per-OS delivery gap (iOS share vs Android Download folder) is
 * normalized here rather than leaked into the engine.
 */
class RnBackupSink implements BackupSink<DeliveryResult> {
  async deliverFile(
    absPath: string,
    suggestedName: string,
  ): Promise<DeliveryResult> {
    // iOS presents a share sheet for the file URL; Android's Share ignores file
    // URLs, so save into a user-visible Download folder and report the path.
    if (Platform.OS === 'ios') {
      await Share.share({ url: `file://${absPath}` });
      return { method: 'shared' };
    }
    await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
      {
        title: 'Storage Permission',
        message: 'Off Grid needs access to save your backup file',
        buttonNeutral: 'Ask Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'OK',
      },
    );
    const dir = `${RNFS.DownloadDirectoryPath}/OffgridBackups`;
    if (!(await RNFS.exists(dir))) await RNFS.mkdir(dir);
    const destPath = `${dir}/${suggestedName}`;
    await RNFS.copyFile(absPath, destPath);
    return {
      method: 'saved',
      location: `Download/OffgridBackups/${suggestedName}`,
    };
  }

  async pickFile(): Promise<string | null> {
    try {
      const files =
        Platform.OS === 'android'
          ? await pick({ mode: 'open', allowMultiSelection: false })
          : await pick({ mode: 'import', allowMultiSelection: false });
      const file = files?.[0];
      if (!file) return null;
      // Resolve to a readable local path (content:// URIs are copied to cache);
      // the archive port unpacks the zip from there.
      return resolvePickedFileUri(file.uri, file.name || 'backup.zip');
    } catch (err: unknown) {
      if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) {
        logger.log('[Backup] import cancelled by user');
        return null;
      }
      throw err;
    }
  }
}

export const backupIo: BackupSink<DeliveryResult> = new RnBackupSink();
