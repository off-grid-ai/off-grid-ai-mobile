import type { FileMapper, FileRef } from '@offgrid/sync/portable';
import type { BackupData } from './types';

// Pure path <-> bundle-key mapping for mobile's backup payload. It knows exactly
// which fields carry on-device file paths — generated-image paths, chat message
// attachments + audio, and knowledge-base document files — and swaps those paths
// for stable bundle-relative keys on export, then back to restored device paths
// on import. No I/O: the engine's archive port does the copying; this only
// rewrites the payload, so it is fully unit-testable.

/** File extension (with dot) of a path/uri, ignoring any query/fragment. '' if none. */
const extOf = (path: string): string => {
  const m = /\.([a-zA-Z0-9]+)(?:[?#].*)?$/.exec(path);
  return m ? `.${m[1]}` : '';
};

const isKey = (v: string): boolean => v.startsWith('files/');

/**
 * Apply `fn` to every file-bearing string in the payload, returning a new
 * payload (immutable). Used by both listKeys (collect) and restore (remap);
 * extract does its own indexed walk because it must MINT keys.
 */
const mapFileValues = (
  data: BackupData,
  fn: (v: string) => string,
): BackupData => ({
  ...data,
  generatedImages: data.generatedImages.map(img => ({
    ...img,
    imagePath: fn(img.imagePath),
  })),
  conversations: data.conversations.map(conv => ({
    ...conv,
    messages: (conv.messages ?? []).map(msg => ({
      ...msg,
      audioPath: msg.audioPath ? fn(msg.audioPath) : msg.audioPath,
      attachments: msg.attachments?.map(att => ({ ...att, uri: fn(att.uri) })),
    })),
  })),
  documentsByProject: Object.fromEntries(
    Object.entries(data.documentsByProject).map(([pid, docs]) => [
      pid,
      docs.map(doc => ({ ...doc, path: fn(doc.path) })),
    ]),
  ),
});

export const mobileFileMapper: FileMapper<BackupData> = {
  extract(data: BackupData): { files: FileRef[]; keyed: BackupData } {
    const files: FileRef[] = [];
    /** Record a real path under a minted key and return the key to store in its place. */
    const take = (sourcePath: string, key: string): string => {
      files.push({ key, sourcePath });
      return key;
    };

    const generatedImages = data.generatedImages.map((img, i) =>
      img.imagePath
        ? {
            ...img,
            imagePath: take(
              img.imagePath,
              `files/img/${i}${extOf(img.imagePath)}`,
            ),
          }
        : img,
    );

    const conversations = data.conversations.map((conv, ci) => ({
      ...conv,
      messages: (conv.messages ?? []).map((msg, mi) => ({
        ...msg,
        audioPath: msg.audioPath
          ? take(
              msg.audioPath,
              `files/audio/${ci}-${mi}${extOf(msg.audioPath)}`,
            )
          : msg.audioPath,
        attachments: msg.attachments?.map((att, ai) =>
          att.uri
            ? {
                ...att,
                uri: take(
                  att.uri,
                  `files/att/${ci}-${mi}-${ai}${extOf(att.uri)}`,
                ),
              }
            : att,
        ),
      })),
    }));

    const documentsByProject: BackupData['documentsByProject'] = {};
    for (const [pid, docs] of Object.entries(data.documentsByProject)) {
      documentsByProject[pid] = docs.map((doc, di) =>
        doc.path
          ? {
              ...doc,
              path: take(
                doc.path,
                `files/doc/${encodeURIComponent(pid)}/${di}${extOf(doc.path)}`,
              ),
            }
          : doc,
      );
    }

    return {
      files,
      keyed: { ...data, generatedImages, conversations, documentsByProject },
    };
  },

  listKeys(keyed: BackupData): string[] {
    const keys: string[] = [];
    mapFileValues(keyed, v => {
      if (v && isKey(v)) keys.push(v);
      return v;
    });
    return keys;
  },

  restore(keyed: BackupData, keyToPath: Record<string, string>): BackupData {
    return mapFileValues(keyed, v => (v && isKey(v) ? keyToPath[v] ?? v : v));
  },
};
