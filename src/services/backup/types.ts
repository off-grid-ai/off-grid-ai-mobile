import type { Conversation, GeneratedImage, Project } from '../../types';
import type { PortableBundle } from '@offgrid/sync/portable';

// The bundle format discriminator, version, and error type are owned by the
// shared portable core (`@offgrid/sync/portable`) so Off Grid Mobile and Desktop
// agree on them and can read each other's bundles. Re-exported here under the
// names this module's callers already use.
export {
  BUNDLE_FORMAT as BACKUP_FORMAT,
  BUNDLE_VERSION as BACKUP_VERSION,
  BundleError as BackupError,
} from '@offgrid/sync/portable';

/**
 * One knowledge-base document, self-contained: its metadata plus every chunk and
 * that chunk's embedding vector. Chunks and their vectors travel together so the
 * doc→chunk→embedding tree can be rebuilt on another device without re-indexing.
 * `embedding` is null when the source chunk had no vector (import regenerates it).
 */
export interface BackupDocument {
  name: string;
  path: string;
  size: number;
  enabled: boolean;
  createdAt: string;
  chunks: BackupChunk[];
}

export interface BackupChunk {
  content: string;
  position: number;
  embedding: number[] | null;
}

/**
 * App-level state that is portable between installs. Deliberately EXCLUDES model
 * binaries (gigabytes, re-downloadable) and Pro activation (device-bound). Voice
 * model id is a preference only — it applies on restore when its model is present.
 */
export interface BackupPreferences {
  interfaceMode?: string;
  whisperModelId?: string | null;
}

/**
 * Mobile's backup payload — the app-specific sections carried inside the shared
 * envelope's generic `data`. Everything needed to restore: projects, all
 * conversations (with their attachments), knowledge bases, the generated-image
 * gallery, and app/model settings — with no reference to device-local row ids
 * (RAG ids are AUTOINCREMENT and not portable, so the tree is rebuilt on import).
 * File-bearing fields (attachment uris, generated-image paths, document paths)
 * hold bundle-relative keys inside a backup zip and are rewritten to real paths
 * on import. `documentsByProject` is keyed by project id. Desktop will define its
 * OWN payload shape; only the envelope around it is shared.
 */
export interface BackupData {
  /** Embedding dimension the vectors were produced at, for compatibility checks. */
  embeddingDimension: number;
  projects: Project[];
  conversations: Conversation[];
  documentsByProject: Record<string, BackupDocument[]>;
  generatedImages: GeneratedImage[];
  /** Partial AppSettings (model + generation settings, enabled tools). Null when not exported. */
  settings: Record<string, unknown> | null;
  preferences: BackupPreferences | null;
}

/** A mobile backup file: the shared portable envelope wrapping mobile's payload. */
export type BackupEnvelope = PortableBundle<BackupData>;

/** What a restore added to the device — the summary the UI reports. */
export interface ImportSummary {
  projectsAdded: number;
  conversationsAdded: number;
  documentsImported: number;
  documentsSkipped: number;
  /** Per-project knowledge-base restore failures (e.g. embedding model unavailable). */
  kbErrors: string[];
}
