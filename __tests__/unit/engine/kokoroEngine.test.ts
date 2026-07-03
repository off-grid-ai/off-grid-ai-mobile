/**
 * KokoroEngine unit tests — install-status detection.
 *
 * Regression coverage for the bug where a fully-downloaded Kokoro model
 * reverted to "downloading"/"not-downloaded" once its executorch bridge
 * unmounted (e.g. switching engines) or after an app restart, because status
 * was derived from the live engine phase + transient in-memory progress.
 *
 * The fix makes checkAssetStatus() consult executorch's on-disk cache
 * (BareResourceFetcher.listDownloadedFiles — ALL cached files, since
 * listDownloadedModels filters to .pte and can't see the voice assets) and
 * treat isFullyDownloaded() — phase==='ready' OR progress>=1 OR the COMPLETE
 * asset set present on disk — as 'downloaded'.
 *
 * Completeness is the full active-voice asset set (two core .pte + voice
 * embedding + tagger + lexicon), NOT just the two .pte: the .pte survive a prior
 * interrupted download, so checking only them reported "downloaded" the instant a
 * fresh download began — the Download Manager showed Kokoro completed (82MB) while
 * the Voice panel correctly showed it at 4%.
 */
import { BareResourceFetcher } from 'react-native-executorch-bare-resource-fetcher';
import { KokoroEngine, type KokoroBridgeHandle } from '../../../pro/audio/engine/tts/engines/kokoro/KokoroEngine';

const listDownloadedFiles =
  BareResourceFetcher.listDownloadedFiles as jest.Mock;
const deleteResources = BareResourceFetcher.deleteResources as jest.Mock;
const fetchResources = (BareResourceFetcher as any).fetch as jest.Mock;

// The two shared core .pte models.
const KOKORO_CORE_FILES = ['duration_predictor.pte', 'synthesizer.pte'];
// The active voice's own assets (see the enriched mockVoiceConfig in jest.setup).
const KOKORO_VOICE_FILES = ['af_heart.bin', 'tagger.pt', 'lexicon.json'];
// A COMPLETE download = core models + the active voice's assets.
const KOKORO_FILES = [...KOKORO_CORE_FILES, ...KOKORO_VOICE_FILES];

const noopHandle: KokoroBridgeHandle = {
  speak: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  setSpeed: jest.fn(),
  setKeepAlive: jest.fn(),
};

// All cached files for a COMPLETE download, as executorch-style cache paths.
const allOnDisk = () => KOKORO_FILES.map((f) => `/data/react-native-executorch/${f}`);

describe('KokoroEngine install status', () => {
  beforeEach(() => {
    listDownloadedFiles.mockReset();
    deleteResources.mockReset().mockResolvedValue(undefined);
    fetchResources?.mockReset().mockResolvedValue(undefined);
    listDownloadedFiles.mockResolvedValue([]);
  });

  it('REGRESSION: a benign "already downloading" collision does not leave the voice stuck at downloading (F23)', async () => {
    // Two overlapping downloadAssets() for the same shared sources: executorch throws
    // "already downloading" on the losing one. That fetch drives progress on ITS own
    // instance, not this one, so returning early here would strand this instance at
    // phase 'downloading' forever (the stuck Voice-row bug). We reconcile from disk.
    const engine = new KokoroEngine();
    // The concurrent (winning) fetch has completed the files on disk by the time our
    // benign catch runs its reconcile scan.
    listDownloadedFiles.mockResolvedValue(allOnDisk());
    fetchResources.mockRejectedValueOnce(new Error('Resource is already downloading'));

    await engine.downloadAssets(); // must not throw

    // Settled from disk truth, not stuck at 'downloading'.
    expect(engine.getPhase()).not.toBe('downloading');
    expect(engine.getPhase()).toBe('idle'); // downloaded on disk, no bridge yet
    expect(engine.isFullyDownloaded()).toBe(true);
  });

  it('REGRESSION: a benign collision with assets NOT yet on disk settles to idle, not stuck downloading (F23)', async () => {
    const engine = new KokoroEngine();
    listDownloadedFiles.mockResolvedValue([]); // concurrent fetch hasn't finished either
    fetchResources.mockRejectedValueOnce(new Error('already downloading'));

    await engine.downloadAssets();

    expect(engine.getPhase()).toBe('idle'); // not 'downloading'
    expect(engine.isFullyDownloaded()).toBe(false);
  });

  it('reports not-downloaded when disk is empty and nothing has loaded', async () => {
    const engine = new KokoroEngine();
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('not-downloaded');
    expect(state.progress).toBe(0);
    expect(engine.isFullyDownloaded()).toBe(false);
  });

  it('reports downloaded when the complete asset set exists on disk (cold start / no bridge)', async () => {
    listDownloadedFiles.mockResolvedValue(allOnDisk());
    const engine = new KokoroEngine();

    // Phase is still 'idle' and no download happened this session — purely disk-derived.
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloaded');
    expect(state.progress).toBe(1);
    expect(engine.getPhase()).toBe('idle');
    expect(engine.isFullyDownloaded()).toBe(true);
    expect(engine.getOverallDownloadProgress()).toBe(1);
  });

  it('treats a partial disk cache (one file) as not-downloaded', async () => {
    listDownloadedFiles.mockResolvedValue([
      `/data/react-native-executorch/${KOKORO_CORE_FILES[0]}`,
    ]);
    const engine = new KokoroEngine();
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('not-downloaded');
  });

  it('REGRESSION: core .pte present but voice assets missing reports NOT downloaded', async () => {
    // The exact reported bug: the two core .pte survive a prior interrupted
    // download, so re-tapping download instantly showed Kokoro "completed" in the
    // Download Manager while the Voice panel honestly showed it at 4%. Only the
    // core models are on disk — the active voice's embedding/tagger/lexicon are not.
    listDownloadedFiles.mockResolvedValue(
      KOKORO_CORE_FILES.map((f) => `/data/react-native-executorch/${f}`),
    );
    const engine = new KokoroEngine();
    engine._setDownloadProgress(0.04); // mid-download, as the Voice panel shows
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloading');
    expect(engine.isFullyDownloaded()).toBe(false);
    expect(engine.getOverallDownloadProgress()).toBeCloseTo(0.04);
  });

  it('REGRESSION: a live download reports downloading even when ALL files are already on disk', async () => {
    // executorch lists a destination basename before its bytes finish (and a prior
    // interrupted attempt leaves files behind), so mid-download the full asset set
    // can be present on disk. The Download Manager then showed Kokoro completed
    // (82MB) while the Voice panel correctly showed 3%. A live download (phase
    // 'downloading' / fractional progress) must win over the disk-presence guess.
    listDownloadedFiles.mockResolvedValue(allOnDisk()); // every basename present
    const engine = new KokoroEngine();
    engine._setDownloadProgress(0.03); // → phase 'downloading', progress 3%
    expect(engine.getPhase()).toBe('downloading');
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloading');
    expect(engine.isFullyDownloaded()).toBe(false);
    expect(engine.getOverallDownloadProgress()).toBeCloseTo(0.03);
  });

  it('REGRESSION: stays downloaded after the bridge unmounts (engine switch)', async () => {
    // Model genuinely on disk for the whole test (a successful disk scan is the
    // authoritative signal).
    listDownloadedFiles.mockResolvedValue(allOnDisk());
    const engine = new KokoroEngine();

    // 1. Bridge mounts, model finishes downloading, engine becomes ready.
    engine._setDownloadProgress(1);
    engine._setBridge(noopHandle, 'af_heart');
    expect(engine.getPhase()).toBe('ready');
    let [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloaded');

    // 2. User switches engine → Kokoro bridge unmounts. Phase drops to idle.
    engine._setBridge(null, 'af_heart');
    expect(engine.getPhase()).toBe('idle');

    // Before the fix this reported 'downloading' forever (progress was 1, phase
    // not ready). It must remain 'downloaded' — the disk cache confirms it.
    [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloaded');
    expect(state.progress).toBe(1);
  });

  it('stays downloaded across a voice switch that resets progress to 0', async () => {
    listDownloadedFiles.mockResolvedValue(allOnDisk());
    const engine = new KokoroEngine();
    await engine.checkAssetStatus(); // primes _diskDownloaded = true

    // Voice change path resets in-memory progress to show a loader.
    engine._setDownloadProgress(0);

    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('downloaded');
  });

  it('does not regress to not-downloaded if the fetcher throws', async () => {
    const engine = new KokoroEngine();
    engine._setDownloadProgress(1); // downloaded this session
    listDownloadedFiles.mockRejectedValue(new Error('fetcher unavailable'));

    const [state] = await engine.checkAssetStatus();
    // Disk check failed but in-session progress still proves it's downloaded.
    expect(state.status).toBe('downloaded');
  });

  it('speak() asks the bridge to re-mount when the model was freed, then streams', async () => {
    const engine = new KokoroEngine();
    // The model was freed under memory pressure — no bridge attached. The bridge
    // registers a mount-requester that (re)attaches the handle when asked.
    engine._setMountRequester(() => engine._setBridge(noopHandle, 'af_heart'));

    await engine.speak('hello');

    expect(noopHandle.speak).toHaveBeenCalledWith('hello', 1);
    expect(engine.getPhase()).toBe('ready');
  });

  it('speak() resolves when the bridge attaches asynchronously after the request', async () => {
    const engine = new KokoroEngine();
    engine._setMountRequester(() => {
      // Simulate React mounting the hook on a later tick.
      setTimeout(() => engine._setBridge(noopHandle, 'af_heart'), 50);
    });

    await engine.speak('async hello');
    expect(noopHandle.speak).toHaveBeenCalledWith('async hello', 1);
  });

  it('speak() rejects when no bridge can mount (unsupported device)', async () => {
    const engine = new KokoroEngine();
    // No mount-requester registered at all.
    await expect(engine.speak('nope')).rejects.toThrow(/bridge not mounted/i);
  });

  it('initialize() remounts the bridge after a residency eviction (manual replay fix)', async () => {
    // REGRESSION: initialize() used to be a no-op, so speak()→initializeEngine()
    // never reloaded an evicted engine and manual replay bailed with phase=idle.
    const engine = new KokoroEngine();
    engine._setMountRequester(() => engine._setBridge(noopHandle, 'af_heart'));
    expect(engine.getPhase()).toBe('idle');

    await engine.initialize();

    expect(engine.getPhase()).toBe('ready');
  });

  it('initialize() is a no-op when the bridge is already attached (ready)', async () => {
    const engine = new KokoroEngine();
    const requester = jest.fn(() => engine._setBridge(noopHandle, 'af_heart'));
    engine._setMountRequester(requester);
    await engine.initialize(); // first mount
    requester.mockClear();

    await engine.initialize(); // already ready → must not re-request a mount
    expect(requester).not.toHaveBeenCalled();
    expect(engine.getPhase()).toBe('ready');
  });

  it('initialize() rejects when no bridge can mount (unsupported device)', async () => {
    const engine = new KokoroEngine();
    await expect(engine.initialize()).rejects.toThrow(/bridge not mounted/i);
  });

  it('release() asks the bridge to unmount so the executorch model is actually freed', async () => {
    // Residency calls release() to reclaim RAM; nulling the handle alone leaves the
    // ~330MB model resident, so release() must trigger the bridge to unmount.
    const engine = new KokoroEngine();
    const unmount = jest.fn();
    engine._setUnmountRequester(unmount);
    engine._setBridge(noopHandle, 'af_heart');
    expect(engine.getPhase()).toBe('ready');
    await engine.release();
    expect(unmount).toHaveBeenCalled();
    expect(engine.getPhase()).toBe('idle');
  });

  it('deleteAssets clears state and removes resources from disk', async () => {
    listDownloadedFiles.mockResolvedValue(allOnDisk());
    const engine = new KokoroEngine();
    engine._setDownloadProgress(1);
    await engine.checkAssetStatus();
    expect(engine.isFullyDownloaded()).toBe(true);

    // deleteAssets re-scans disk at the end; simulate the files being gone so the
    // post-delete scan is conclusive-empty.
    listDownloadedFiles.mockResolvedValue([]);
    await engine.deleteAssets();
    expect(deleteResources).toHaveBeenCalled();

    // deleteAssets re-scanned → already not-downloaded without a manual re-check.
    expect(engine.isFullyDownloaded()).toBe(false);
    const [state] = await engine.checkAssetStatus();
    expect(state.status).toBe('not-downloaded');
  });

  it('REGRESSION: deleteAssets removes the FULL active-voice set, not just the core .pte', async () => {
    // The bug: deleteAssets deleted only the two core .pte files, leaving the
    // voice embedding/tagger/lexicon on disk. The completeness scan checks the
    // full set, so the Download Manager kept showing Kokoro "downloaded" after a
    // Remove. Delete must target the same set download + completeness use.
    listDownloadedFiles.mockResolvedValue(allOnDisk());
    const engine = new KokoroEngine();
    await engine.checkAssetStatus();

    await engine.deleteAssets();

    const deleted: string[] = deleteResources.mock.calls[0] ?? [];
    // Every required source (core + voice/tagger/lexicon) must be in the delete set.
    for (const f of KOKORO_FILES) {
      expect(deleted.some((url) => url.split(/[?#]/)[0].split('/').pop() === f)).toBe(true);
    }
  });

  it('a conclusive empty disk scan beats stale in-session progress', async () => {
    // After a delete, a transient bridge re-render can leave _downloadProgress
    // at 1. A successful (conclusive) disk scan finding nothing must still report
    // not-downloaded — otherwise the Voice panel keeps showing "downloaded" after
    // a removal. (Contrast: when the scan THROWS, progress>=1 is trusted — see
    // the fetcher-unavailable case above.)
    const engine = new KokoroEngine();
    engine._setDownloadProgress(1); // stale leftover
    listDownloadedFiles.mockResolvedValue([]); // conclusive: nothing on disk
    await engine.checkAssetStatus();
    expect(engine.isFullyDownloaded()).toBe(false);
  });
});
