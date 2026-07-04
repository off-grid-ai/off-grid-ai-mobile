/**
 * BATCH 8 — Storage Settings: stale-download detection + Clear All.
 *
 * Plan cases 25/26: recognise stale download entries and clear them.
 *
 * The stale predicate + clear-all set now live ONCE in the download store
 * (isStaleDownload / selectStaleDownloads) and StorageSettingsScreen renders/clears
 * from them. These tests drive the REAL exported predicate and the REAL
 * useDownloadStore.remove — not a re-implemented copy — so a drift in the predicate
 * (or deleting remove) fails them.
 */
import { useDownloadStore, isStaleDownload, selectStaleDownloads } from '../../src/stores/downloadStore';
import type { DownloadEntry } from '../../src/stores/downloadStore';

const entry = (over: Partial<DownloadEntry>): DownloadEntry => ({
  modelKey: 'org/repo/m.gguf' as any,
  downloadId: 'dl-1',
  modelId: 'org/repo',
  fileName: 'm.gguf',
  quantization: 'Q4_K_M',
  modelType: 'text' as any,
  status: 'completed',
  progress: 1,
  bytesDownloaded: 100,
  totalBytes: 100,
  combinedTotalBytes: 100,
  createdAt: 0,
  ...over,
});

const seed = (entries: DownloadEntry[]) => {
  const map: Record<string, DownloadEntry> = {};
  for (const e of entries) map[e.modelKey] = e;
  useDownloadStore.setState({ downloads: map, downloadIdIndex: {} } as any);
};

beforeEach(() => {
  useDownloadStore.setState({ downloads: {}, downloadIdIndex: {} } as any);
});

describe('isStaleDownload — the real predicate the screen uses', () => {
  it('a complete entry (all fields) is NOT stale', () => {
    expect(isStaleDownload(entry({}))).toBe(false);
  });
  it('missing modelId → stale', () => {
    expect(isStaleDownload(entry({ modelId: '' as any }))).toBe(true);
  });
  it('missing fileName → stale', () => {
    expect(isStaleDownload(entry({ fileName: '' as any }))).toBe(true);
  });
  it('missing combinedTotalBytes (0/undefined) → stale', () => {
    expect(isStaleDownload(entry({ combinedTotalBytes: 0 }))).toBe(true);
    expect(isStaleDownload(entry({ combinedTotalBytes: undefined as any }))).toBe(true);
  });
});

describe('selectStaleDownloads + Clear All (cases 25, 26)', () => {
  it('recognises exactly the stale entries in a mixed store', () => {
    seed([
      entry({ modelKey: 'a/good.gguf' as any }),                       // healthy
      entry({ modelKey: 'b/nomodel' as any, modelId: '' as any }),     // stale
      entry({ modelKey: 'c/noname' as any, fileName: '' as any }),     // stale
      entry({ modelKey: 'd/nobytes' as any, combinedTotalBytes: 0 }),  // stale
    ]);
    const stale = selectStaleDownloads(useDownloadStore.getState().downloads);
    expect(stale.map(s => s.modelKey).sort()).toEqual(['b/nomodel', 'c/noname', 'd/nobytes']);
  });

  it('Clear All removes every stale entry and keeps the healthy one (real store.remove)', () => {
    seed([
      entry({ modelKey: 'a/good.gguf' as any }),
      entry({ modelKey: 'b/nomodel' as any, modelId: '' as any }),
      entry({ modelKey: 'c/nobytes' as any, combinedTotalBytes: 0 }),
    ]);
    const { remove } = useDownloadStore.getState();
    // The exact loop the screen's Clear All onPress runs.
    for (const s of selectStaleDownloads(useDownloadStore.getState().downloads)) remove(s.modelKey);

    const after = useDownloadStore.getState().downloads;
    expect(Object.keys(after)).toEqual(['a/good.gguf']);
    expect(selectStaleDownloads(after)).toHaveLength(0); // idempotent: nothing left to clean
  });

  it('Clear All is a no-op when there are no stale entries', () => {
    seed([entry({ modelKey: 'a/good.gguf' as any })]);
    const { remove } = useDownloadStore.getState();
    const stale = selectStaleDownloads(useDownloadStore.getState().downloads);
    expect(stale).toHaveLength(0);
    for (const s of stale) remove(s.modelKey);
    expect(Object.keys(useDownloadStore.getState().downloads)).toEqual(['a/good.gguf']);
  });
});
