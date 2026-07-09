import type { BackupDataPort } from '@offgrid/sync/portable';
import { BundleError } from '@offgrid/sync/portable';
import type { Conversation, GeneratedImage, Project } from '../../types';
import { useProjectStore } from '../../stores/projectStore';
import { useChatStore } from '../../stores/chatStore';
import { useAppStore } from '../../stores/appStore';
import type { AppSettings } from '../../stores/appStore';
import { useUiModeStore } from '../../stores/uiModeStore';
import { useWhisperStore } from '../../stores/whisperStore';
import { ragService } from '../rag';
import { embeddingService } from '../rag/embedding';
import type {
  BackupData,
  BackupDocument,
  BackupPreferences,
  ImportSummary,
} from './types';

const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Extra app-level state carried only by a full "export everything". */
interface Extras {
  generatedImages: GeneratedImage[];
  settings: Record<string, unknown> | null;
  preferences: BackupPreferences | null;
}

/**
 * Mobile's implementation of the shared engine's data port: the ONE place that
 * reads from and writes to mobile's stores + RAG. It collects payloads for
 * export, validates a payload parsed from a bundle, and applies a payload
 * additively on restore. The export/import FLOW lives in @offgrid/sync/portable;
 * only this store/DB access is mobile-specific.
 *
 * Restore is additive for CONTENT (mergeById + ragDatabase.importDocument):
 * existing projects/conversations/documents/images are never overwritten or
 * removed; only missing items are added. App SETTINGS/preferences are the one
 * thing a restore is meant to re-apply (that is the point of "restore my setup"),
 * so those are merged over the current values.
 */
class MobileBackupData implements BackupDataPort<BackupData, ImportSummary> {
  private async collectDocuments(
    projectIds: string[],
  ): Promise<Record<string, BackupDocument[]>> {
    const out: Record<string, BackupDocument[]> = {};
    for (const projectId of projectIds) {
      const docs = await ragService.exportProjectDocuments(projectId);
      if (docs.length > 0) out[projectId] = docs;
    }
    return out;
  }

  /** Gallery images belonging to any of the given conversations. */
  private imagesForConversations(
    conversationIds: Set<string>,
  ): GeneratedImage[] {
    return useAppStore
      .getState()
      .generatedImages.filter(
        img =>
          img.conversationId != null && conversationIds.has(img.conversationId),
      );
  }

  private payload(input: {
    projects: Project[];
    conversations: Conversation[];
    documentsByProject: Record<string, BackupDocument[]>;
    extras: Extras;
  }): BackupData {
    return {
      embeddingDimension: embeddingService.getDimension(),
      projects: input.projects,
      conversations: input.conversations,
      documentsByProject: input.documentsByProject,
      generatedImages: input.extras.generatedImages,
      settings: input.extras.settings,
      preferences: input.extras.preferences,
    };
  }

  async collectAll(): Promise<BackupData> {
    const projects = useProjectStore.getState().projects;
    const conversations = useChatStore.getState().conversations;
    const documentsByProject = await this.collectDocuments(
      projects.map(p => p.id),
    );
    // Everything: whole gallery, app/model settings, and the restorable prefs.
    const app = useAppStore.getState();
    const extras: Extras = {
      generatedImages: app.generatedImages,
      settings: app.settings as Record<string, unknown>,
      preferences: {
        interfaceMode: useUiModeStore.getState().interfaceMode,
        whisperModelId: useWhisperStore.getState().downloadedModelId,
      },
    };
    return this.payload({
      projects,
      conversations,
      documentsByProject,
      extras,
    });
  }

  async collectProject(projectId: string): Promise<BackupData | null> {
    const project = useProjectStore
      .getState()
      .projects.find(p => p.id === projectId);
    if (!project) return null;
    const conversations = useChatStore
      .getState()
      .conversations.filter(c => c.projectId === projectId);
    const documentsByProject = await this.collectDocuments([projectId]);
    // A project export carries its own images but NOT app-global settings/prefs.
    const extras: Extras = {
      generatedImages: this.imagesForConversations(
        new Set(conversations.map(c => c.id)),
      ),
      settings: null,
      preferences: null,
    };
    return this.payload({
      projects: [project],
      conversations,
      documentsByProject,
      extras,
    });
  }

  async collectConversation(
    conversationId: string,
  ): Promise<BackupData | null> {
    const conversation = useChatStore
      .getState()
      .conversations.find(c => c.id === conversationId);
    if (!conversation) return null;
    // Carry the parent project's metadata so the conversation's projectId still
    // resolves on restore. No knowledge base — a single chat doesn't ship docs.
    const parent = conversation.projectId
      ? useProjectStore
          .getState()
          .projects.find(p => p.id === conversation.projectId)
      : undefined;
    const extras: Extras = {
      generatedImages: this.imagesForConversations(new Set([conversationId])),
      settings: null,
      preferences: null,
    };
    return this.payload({
      projects: parent ? [parent] : [],
      conversations: [conversation],
      documentsByProject: documentsEmpty(),
      extras,
    });
  }

  /** Validate + normalize a payload parsed from a bundle. Throws BundleError if malformed. */
  validate(data: unknown): BackupData {
    if (
      !isObject(data) ||
      !Array.isArray(data.projects) ||
      !Array.isArray(data.conversations)
    ) {
      throw new BundleError(
        'This backup is missing its projects or conversations.',
      );
    }
    return {
      embeddingDimension:
        typeof data.embeddingDimension === 'number'
          ? data.embeddingDimension
          : 0,
      projects: data.projects as Project[],
      conversations: data.conversations as Conversation[],
      documentsByProject: isObject(data.documentsByProject)
        ? (data.documentsByProject as Record<string, BackupDocument[]>)
        : {},
      generatedImages: Array.isArray(data.generatedImages)
        ? (data.generatedImages as GeneratedImage[])
        : [],
      settings: isObject(data.settings)
        ? (data.settings as Record<string, unknown>)
        : null,
      preferences: isObject(data.preferences)
        ? (data.preferences as BackupPreferences)
        : null,
    };
  }

  async apply(data: BackupData): Promise<ImportSummary> {
    const projectsAdded = useProjectStore
      .getState()
      .importProjects(data.projects).length;
    const conversationsAdded = useChatStore
      .getState()
      .importConversations(data.conversations).length;
    // Gallery is additive (mergeById) like projects/conversations.
    if (data.generatedImages.length > 0) {
      useAppStore.getState().importGeneratedImages(data.generatedImages);
    }
    // Settings/preferences are re-applied (the point of "restore my setup").
    if (data.settings) {
      useAppStore
        .getState()
        .updateSettings(data.settings as Partial<AppSettings>);
    }
    this.applyPreferences(data.preferences);

    let documentsImported = 0;
    let documentsSkipped = 0;
    const kbErrors: string[] = [];
    for (const [projectId, docs] of Object.entries(data.documentsByProject)) {
      try {
        const result = await ragService.importProjectDocuments(projectId, docs);
        documentsImported += result.imported;
        documentsSkipped += result.skipped;
      } catch (e) {
        // KB restore needs the embedding model; if it can't load, projects and
        // conversations are still restored — report the KB gap honestly.
        kbErrors.push(errorMessage(e));
      }
    }
    return {
      projectsAdded,
      conversationsAdded,
      documentsImported,
      documentsSkipped,
      kbErrors,
    };
  }

  /** Re-apply restorable preferences, best-effort — never fail the import over these. */
  private applyPreferences(preferences: BackupPreferences | null): void {
    if (!preferences) return;
    const { interfaceMode, whisperModelId } = preferences;
    if (interfaceMode === 'chat' || interfaceMode === 'audio') {
      useUiModeStore.getState().setInterfaceMode(interfaceMode);
    }
    // selectModel also loads the model; it may not be present on this device, so
    // swallow failures — the rest of the restore has already succeeded.
    if (whisperModelId) {
      useWhisperStore
        .getState()
        .selectModel(whisperModelId)
        .catch(() => undefined);
    }
  }
}

const documentsEmpty = (): Record<string, BackupDocument[]> => ({});

export const backupData = new MobileBackupData();
export { MobileBackupData };
