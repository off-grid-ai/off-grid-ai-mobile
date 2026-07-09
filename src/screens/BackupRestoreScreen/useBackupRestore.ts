import { useCallback, useState } from 'react';
import { AlertState, initialAlertState, showAlert } from '../../components/CustomAlert';
import { backupService, DeliveryResult } from '../../services/backup';
import logger from '../../utils/logger';
import { formatDeliveryMessage, formatImportSummary } from './messages';

export type BackupBusy = 'export' | 'import' | null;

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * ViewModel for every backup/restore surface (the settings screen, a project
 * page, a chat menu). Holds ONLY view state (a busy flag and the alert to show)
 * and DISPATCHES intents to backupService, which owns all the collect/merge/
 * knowledge-base logic. No business logic lives here — the same hook backs all
 * three surfaces so their behaviour can't drift.
 */
export const useBackupRestore = () => {
  const [busy, setBusy] = useState<BackupBusy>(null);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const runExport = useCallback(async (produce: () => Promise<DeliveryResult | null>) => {
    setBusy('export');
    try {
      const result = await produce();
      if (result) {
        setAlertState(showAlert('Backup created', formatDeliveryMessage(result)));
      } else {
        setAlertState(showAlert('Nothing to export', 'That item could not be found.'));
      }
    } catch (e) {
      logger.error('[Backup] export failed', e);
      setAlertState(showAlert('Export failed', errorMessage(e)));
    } finally {
      setBusy(null);
    }
  }, []);

  const exportAll = useCallback(() => runExport(() => backupService.exportAll()), [runExport]);
  const exportProject = useCallback(
    (projectId: string) => runExport(() => backupService.exportProject(projectId)),
    [runExport],
  );
  const exportConversation = useCallback(
    (conversationId: string) => runExport(() => backupService.exportConversation(conversationId)),
    [runExport],
  );

  const importFromFile = useCallback(async () => {
    setBusy('import');
    try {
      const summary = await backupService.importFromFile();
      if (summary) setAlertState(showAlert('Restore complete', formatImportSummary(summary)));
    } catch (e) {
      logger.error('[Backup] import failed', e);
      setAlertState(showAlert('Import failed', errorMessage(e)));
    } finally {
      setBusy(null);
    }
  }, []);

  return { busy, alertState, setAlertState, exportAll, exportProject, exportConversation, importFromFile };
};
