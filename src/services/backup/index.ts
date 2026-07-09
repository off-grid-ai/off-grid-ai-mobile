export { backupService, BackupService } from './backupService';
export { backupData, MobileBackupData } from './backupData';
export { mobileFileMapper } from './backupFiles';
export { backupArchive } from './backupArchive';
export { backupIo } from './backupIo';
export type { DeliveryResult } from './backupIo';
// The additive-merge rule + envelope contract + export/import engine are owned
// by the shared portable core so every Off Grid surface behaves identically.
export { mergeById } from '@offgrid/sync/portable';
export type { MergeResult, HasId } from '@offgrid/sync/portable';
export { BACKUP_FORMAT, BACKUP_VERSION, BackupError } from './types';
export type {
  BackupEnvelope,
  BackupData,
  BackupDocument,
  BackupChunk,
  ImportSummary,
} from './types';
