// Pure tests for mobile's FileMapper: it must find every file-bearing field
// (generated-image paths, message attachments + audio, KB doc paths), swap each
// for a stable bundle key on extract, list those keys, and restore them back to
// real paths. Round-trip (extract -> restore) must recover the originals.
import { mobileFileMapper } from '../../../src/services/backup/backupFiles';
import type { BackupData } from '../../../src/services/backup/types';
import type { Conversation, GeneratedImage } from '../../../src/types';

const make = (): BackupData => ({
  embeddingDimension: 384,
  projects: [],
  conversations: [
    {
      id: 'c1',
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'hi',
          timestamp: 0,
          attachments: [{ id: 'a1', type: 'image', uri: 'file:///att/x.jpg' }],
          audioPath: '/aud/y.wav',
        },
      ],
    } as unknown as Conversation,
  ],
  documentsByProject: {
    p1: [
      {
        name: 'd',
        path: '/docs/d.pdf',
        size: 1,
        enabled: true,
        createdAt: '',
        chunks: [],
      },
    ],
  },
  generatedImages: [
    {
      id: 'i1',
      imagePath: '/img/a.png',
      conversationId: 'c1',
    } as unknown as GeneratedImage,
  ],
  settings: null,
  preferences: null,
});

describe('mobileFileMapper.extract', () => {
  it('collects every file-bearing path with a stable key and rewrites the payload', () => {
    const { files, keyed } = mobileFileMapper.extract(make());

    // Every file field is captured, extension preserved, key deterministic.
    expect(files).toEqual(
      expect.arrayContaining([
        { key: 'files/img/0.png', sourcePath: '/img/a.png' },
        { key: 'files/audio/0-0.wav', sourcePath: '/aud/y.wav' },
        { key: 'files/att/0-0-0.jpg', sourcePath: 'file:///att/x.jpg' },
        { key: 'files/doc/p1/0.pdf', sourcePath: '/docs/d.pdf' },
      ]),
    );
    expect(files).toHaveLength(4);

    // The keyed payload holds keys, not the original device paths.
    expect(keyed.generatedImages[0].imagePath).toBe('files/img/0.png');
    expect(keyed.conversations[0].messages[0].audioPath).toBe(
      'files/audio/0-0.wav',
    );
    expect(keyed.conversations[0].messages[0].attachments![0].uri).toBe(
      'files/att/0-0-0.jpg',
    );
    expect(keyed.documentsByProject.p1[0].path).toBe('files/doc/p1/0.pdf');
  });

  it('does not capture empty/missing paths', () => {
    const data = make();
    data.generatedImages[0] = { ...data.generatedImages[0], imagePath: '' };
    const { files } = mobileFileMapper.extract(data);
    expect(files.map(f => f.key)).not.toContain('files/img/0.png');
    expect(files).toHaveLength(3);
  });
});

describe('mobileFileMapper.listKeys + restore', () => {
  it('lists the keys embedded in a keyed payload', () => {
    const { keyed } = mobileFileMapper.extract(make());
    expect(mobileFileMapper.listKeys(keyed).sort()).toEqual(
      [
        'files/att/0-0-0.jpg',
        'files/audio/0-0.wav',
        'files/doc/p1/0.pdf',
        'files/img/0.png',
      ].sort(),
    );
  });

  it('round-trips: restore(extract(data).keyed, map) recovers real paths', () => {
    const { files, keyed } = mobileFileMapper.extract(make());
    // Simulate the archive restoring each key to a real device path.
    const keyToPath = Object.fromEntries(
      files.map(f => [f.key, `/restored/${f.key}`]),
    );
    const restored = mobileFileMapper.restore(keyed, keyToPath);

    expect(restored.generatedImages[0].imagePath).toBe(
      '/restored/files/img/0.png',
    );
    expect(restored.conversations[0].messages[0].audioPath).toBe(
      '/restored/files/audio/0-0.wav',
    );
    expect(restored.conversations[0].messages[0].attachments![0].uri).toBe(
      '/restored/files/att/0-0-0.jpg',
    );
    expect(restored.documentsByProject.p1[0].path).toBe(
      '/restored/files/doc/p1/0.pdf',
    );
  });

  it('leaves a key untouched when the restore map lacks it', () => {
    const { keyed } = mobileFileMapper.extract(make());
    const restored = mobileFileMapper.restore(keyed, {}); // empty map
    expect(restored.generatedImages[0].imagePath).toBe('files/img/0.png'); // unchanged
  });
});
