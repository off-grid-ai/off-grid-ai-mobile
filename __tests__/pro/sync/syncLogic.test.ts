/**
 * Real tests for the pro sync LOGIC (TransportSink, ClipboardSync, ShareService)
 * driven against a FAKE SyncTransport that records wire ops + can inject inbound
 * files/app-messages. Nothing that needs a device is mocked-as-itself: the sink,
 * the clipboard echo-guard/size-cap, and the share receive->importPath wiring are
 * the REAL code under test. Deleting any of that logic fails these.
 */
import { TransportSink } from '@offgrid/pro/sync/transportSink';
import {
  ClipboardSync,
  MAX_CLIPBOARD_LEN,
} from '@offgrid/pro/sync/clipboardSync';
import { ShareService } from '@offgrid/pro/sync/shareService';
import type { SyncTransport } from '@offgrid/pro/sync/types';
import type { ClipboardPort } from '@offgrid/pro/sync/clipboardSync';

// A real, inspectable fake transport.
function makeTransport() {
  const sentFiles: Array<{ deviceId: string; path: string; name: string }> = [];
  const sentApp: Array<{ deviceId: string; channel: string; data: unknown }> =
    [];
  let fileHandler: ((d: string, p: string, n: string) => void) | undefined;
  let appHandler: ((d: string, c: string, data: unknown) => void) | undefined;
  let connected: string[] = ['peer-1', 'peer-2'];
  const transport: SyncTransport = {
    async sendFile(deviceId, path, name) {
      sentFiles.push({ deviceId, path, name });
    },
    onFile(h) {
      fileHandler = h;
      return () => {
        fileHandler = undefined;
      };
    },
    sendApp(deviceId, channel, data) {
      sentApp.push({ deviceId, channel, data });
    },
    onApp(h) {
      appHandler = h;
      return () => {
        appHandler = undefined;
      };
    },
    connectedDeviceIds() {
      return connected;
    },
  };
  return {
    transport,
    sentFiles,
    sentApp,
    injectFile: (d: string, p: string, n: string) => fileHandler?.(d, p, n),
    injectApp: (d: string, c: string, data: unknown) =>
      appHandler?.(d, c, data),
    setConnected: (ids: string[]) => {
      connected = ids;
    },
  };
}

describe('TransportSink', () => {
  it('deliverFile pushes the bundle zip to the target device and reports it', async () => {
    const t = makeTransport();
    const sink = new TransportSink(t.transport, 'peer-1');
    const result = await sink.deliverFile(
      '/tmp/backup.zip',
      'offgrid-backup.zip',
    );
    expect(result).toEqual({ sentTo: 'peer-1' });
    expect(t.sentFiles).toEqual([
      {
        deviceId: 'peer-1',
        path: '/tmp/backup.zip',
        name: 'offgrid-backup.zip',
      },
    ]);
  });

  it('pickFile returns null (push-only sink, never pulls)', async () => {
    const sink = new TransportSink(makeTransport().transport, 'peer-1');
    expect(await sink.pickFile()).toBeNull();
  });
});

describe('ClipboardSync', () => {
  it('broadcasts local clipboard text to every connected device', () => {
    const t = makeTransport();
    const clip: ClipboardPort = { get: async () => '', set: jest.fn() };
    new ClipboardSync(t.transport, clip).broadcastLocal('hello');
    expect(t.sentApp).toEqual([
      { deviceId: 'peer-1', channel: 'clipboard', data: { text: 'hello' } },
      { deviceId: 'peer-2', channel: 'clipboard', data: { text: 'hello' } },
    ]);
  });

  it('does not broadcast empty or oversized text', () => {
    const t = makeTransport();
    const sync = new ClipboardSync(t.transport, {
      get: async () => '',
      set: jest.fn(),
    });
    sync.broadcastLocal('');
    sync.broadcastLocal('x'.repeat(MAX_CLIPBOARD_LEN + 1));
    expect(t.sentApp).toHaveLength(0);
  });

  it('writes received clipboard text to the local clipboard', () => {
    const t = makeTransport();
    const set = jest.fn();
    const sync = new ClipboardSync(t.transport, { get: async () => '', set });
    sync.attach();
    t.injectApp('peer-1', 'clipboard', { text: 'from laptop' });
    expect(set).toHaveBeenCalledWith('from laptop');
  });

  it('does NOT echo received text back out (no loop)', () => {
    const t = makeTransport();
    const sync = new ClipboardSync(t.transport, {
      get: async () => '',
      set: jest.fn(),
    });
    sync.attach();
    t.injectApp('peer-1', 'clipboard', { text: 'echo me' });
    t.sentApp.length = 0; // clear
    // The device now "sees" its own clipboard change and tries to broadcast it:
    sync.broadcastLocal('echo me');
    expect(t.sentApp).toHaveLength(0); // suppressed — it's what we just received
  });

  it('ignores non-clipboard channels and malformed payloads', () => {
    const t = makeTransport();
    const set = jest.fn();
    new ClipboardSync(t.transport, { get: async () => '', set }).attach();
    t.injectApp('peer-1', 'other', { text: 'nope' });
    t.injectApp('peer-1', 'clipboard', { notText: 1 });
    expect(set).not.toHaveBeenCalled();
  });

  it('detach stops applying incoming messages', () => {
    const t = makeTransport();
    const set = jest.fn();
    const sync = new ClipboardSync(t.transport, { get: async () => '', set });
    sync.attach();
    sync.detach();
    t.injectApp('peer-1', 'clipboard', { text: 'after detach' });
    expect(set).not.toHaveBeenCalled();
  });
});

describe('ShareService', () => {
  // Fake core ports so no SQLite/RNFS is touched — the SHARE wiring is under test,
  // not the engine internals (those are covered in the shared package's own tests).
  const fakeData = {
    collectAll: async () => ({ marker: 'all' }),
    collectProject: async (id: string) =>
      id === 'p1' ? { marker: 'p1' } : null,
    collectConversation: async (id: string) =>
      id === 'c1' ? { marker: 'c1' } : null,
    validate: (d: unknown) => d,
    apply: async (d: any) => ({ applied: d.marker } as any),
  } as any;
  const fakeFiles = {
    extract: (d: any) => ({ files: [], keyed: d }),
    listKeys: () => [],
    restore: (d: any) => d,
  } as any;
  // In-memory archive: pack returns a path; unpack reads back the staged envelope.
  function fakeArchive() {
    const store = new Map<string, string>();
    let n = 0;
    return {
      stageDir: async () => `/stage${n++}`,
      writeText: async (p: string, t: string) => {
        store.set(p, t);
      },
      readText: async (p: string) => store.get(p) ?? '',
      copyInto: async () => {},
      pack: async (dir: string, name: string) => {
        store.set(`/out/${name}`, store.get(`${dir}/backup.json`) ?? '');
        return `/out/${name}`;
      },
      unpack: async (zip: string) => {
        store.set('/un/backup.json', store.get(zip) ?? '');
        return '/un';
      },
      restorePathFor: (k: string) => `/r/${k}`,
      join: (...p: string[]) => p.join('/'),
    } as any;
  }

  it('shareProject pushes a bundle for the project to the target device', async () => {
    const t = makeTransport();
    const svc = new ShareService({
      transport: t.transport,
      data: fakeData,
      files: fakeFiles,
      archive: fakeArchive(),
      now: () => '2026-07-09T00:00:00.000Z',
    });
    const result = await svc.shareProject('p1', 'peer-1');
    expect(result).toEqual({ sentTo: 'peer-1' });
    expect(t.sentFiles).toHaveLength(1);
    expect(t.sentFiles[0].deviceId).toBe('peer-1');
    expect(t.sentFiles[0].name).toMatch(/^offgrid-project-/);
  });

  it('shareProject sends nothing for a missing project', async () => {
    const t = makeTransport();
    const svc = new ShareService({
      transport: t.transport,
      data: fakeData,
      files: fakeFiles,
      archive: fakeArchive(),
      now: () => 'now',
    });
    const result = await svc.shareProject('missing', 'peer-1');
    expect(result).toBeNull();
    expect(t.sentFiles).toHaveLength(0);
  });

  it('receive applies a pushed bundle additively via importPath and reports the summary', async () => {
    const t = makeTransport();
    const archive = fakeArchive();
    // Seed a received zip at the path the transport will hand us.
    await archive.writeText(
      '/received.zip',
      JSON.stringify({
        format: 'offgrid-backup',
        version: 1,
        exportedAt: 'now',
        data: { marker: 'incoming' },
      }),
    );
    const applied: any[] = [];
    const data = {
      ...fakeData,
      apply: async (d: any) => {
        applied.push(d);
        return { applied: d.marker };
      },
    };
    const svc = new ShareService({
      transport: t.transport,
      data,
      files: fakeFiles,
      archive,
      now: () => 'now',
    });

    const seen: any[] = [];
    svc.receive((deviceId, summary) => seen.push({ deviceId, summary }));
    t.injectFile('peer-2', '/received.zip', 'offgrid-backup.zip');
    await new Promise(r => setImmediate(r)); // let the async handler run

    expect(applied).toEqual([{ marker: 'incoming' }]);
    expect(seen).toEqual([
      { deviceId: 'peer-2', summary: { applied: 'incoming' } },
    ]);
  });
});
