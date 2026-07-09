import { BackupEngine } from '@offgrid/sync/portable';
import type {
  BackupDataPort,
  FileMapper,
  ArchivePort,
  BackupSink,
} from '@offgrid/sync/portable';
import { backupData } from './backupData';
import { mobileFileMapper } from './backupFiles';
import { backupArchive } from './backupArchive';
import { backupIo, DeliveryResult } from './backupIo';
import type { BackupData, ImportSummary } from './types';

/**
 * Thin composition root for backup/restore on mobile. It wires the shared
 * BackupEngine to mobile's four ports — data (stores + RAG), file mapper (path
 * rewriting), archive (RNFS + zip), and sink (share sheet / picker) — and holds
 * no flow logic of its own. All orchestration lives in @offgrid/sync/portable.
 * The screens dispatch these intents and render the returned summary.
 */
/** The four ports the engine needs; each defaults to mobile's real adapter (overridable in tests). */
interface BackupDeps {
  data?: BackupDataPort<BackupData, ImportSummary>;
  files?: FileMapper<BackupData>;
  archive?: ArchivePort;
  sink?: BackupSink<DeliveryResult>;
}

class BackupService {
  private readonly engine: BackupEngine<
    BackupData,
    ImportSummary,
    DeliveryResult
  >;

  constructor(deps: BackupDeps = {}) {
    this.engine = new BackupEngine(
      deps.data ?? backupData,
      deps.files ?? mobileFileMapper,
      deps.archive ?? backupArchive,
      deps.sink ?? backupIo,
      () => new Date().toISOString(),
    );
  }

  /** Export everything: all projects, all conversations, every knowledge base + files. */
  exportAll = (): Promise<DeliveryResult | null> => this.engine.exportAll();

  /** Export one project (its chats + knowledge base + files). Null if the project is gone. */
  exportProject = (projectId: string): Promise<DeliveryResult | null> =>
    this.engine.exportProject(projectId);

  /** Export one conversation, self-contained. Null if the conversation is gone. */
  exportConversation = (
    conversationId: string,
  ): Promise<DeliveryResult | null> =>
    this.engine.exportConversation(conversationId);

  /** Pick a backup file and restore it additively (files + data). Null if the user cancels. */
  importFromFile = (): Promise<ImportSummary | null> => this.engine.import();
}

export const backupService = new BackupService();
export { BackupService };
