// Drives the REAL MobileBackupData against the REAL zustand stores (asserting
// store state, not mock calls) with only the native boundaries (RAG SQLite +
// embedding model) stubbed. Deleting the collect/apply logic must fail these.
jest.mock('../../../src/services/rag', () => ({
  ragService: {
    exportProjectDocuments: jest.fn(async () => []),
    importProjectDocuments: jest.fn(async () => ({ imported: 0, skipped: 0 })),
    deleteProjectDocuments: jest.fn(async () => undefined),
  },
}));
jest.mock('../../../src/services/rag/embedding', () => ({
  embeddingService: {
    getDimension: () => 384,
    load: jest.fn(async () => undefined),
  },
}));

import { backupData } from '../../../src/services/backup/backupData';
import { useProjectStore } from '../../../src/stores/projectStore';
import { useChatStore } from '../../../src/stores/chatStore';
import { useAppStore } from '../../../src/stores/appStore';
import { useUiModeStore } from '../../../src/stores/uiModeStore';
import type { Project, Conversation, GeneratedImage } from '../../../src/types';

const project = (id: string, name = id): Project =>
  ({
    id,
    name,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  } as unknown as Project);
const conversation = (id: string, projectId?: string): Conversation =>
  ({
    id,
    projectId,
    messages: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  } as unknown as Conversation);
const image = (id: string, conversationId?: string): GeneratedImage =>
  ({
    id,
    conversationId,
    imagePath: `/imgs/${id}.png`,
    prompt: '',
    width: 1,
    height: 1,
    steps: 1,
    seed: 1,
    modelId: 'm',
    createdAt: '2026-01-01',
  } as unknown as GeneratedImage);

describe('MobileBackupData — full-state collect', () => {
  beforeEach(() => {
    useProjectStore.setState({ projects: [project('p1')] });
    useChatStore.setState({ conversations: [conversation('c1', 'p1')] });
    useAppStore.setState({
      generatedImages: [image('img1', 'c1'), image('imgX', 'other')],
    });
    useUiModeStore.setState({ interfaceMode: 'audio' });
  });

  it('collectAll gathers projects, conversations, gallery, settings, and preferences', async () => {
    const data = await backupData.collectAll();
    expect(data.projects.map(p => p.id)).toEqual(['p1']);
    expect(data.conversations.map(c => c.id)).toEqual(['c1']);
    expect(data.generatedImages.map(i => i.id).sort()).toEqual(
      ['imgX', 'img1'].sort(),
    );
    expect(data.settings).not.toBeNull();
    expect(data.preferences?.interfaceMode).toBe('audio');
    expect(data.embeddingDimension).toBe(384);
  });

  it("collectProject carries only the project's own images, no app settings/prefs", async () => {
    const data = await backupData.collectProject('p1');
    expect(data).not.toBeNull();
    // img1 belongs to c1 (in p1); imgX does not -> excluded.
    expect(data!.generatedImages.map(i => i.id)).toEqual(['img1']);
    expect(data!.settings).toBeNull();
    expect(data!.preferences).toBeNull();
  });

  it('collectProject returns null for a missing project', async () => {
    expect(await backupData.collectProject('nope')).toBeNull();
  });
});

describe('MobileBackupData — additive apply', () => {
  beforeEach(() => {
    useProjectStore.setState({ projects: [project('p1', 'original name')] });
    useChatStore.setState({ conversations: [] });
    useAppStore.setState({ generatedImages: [] });
  });

  it('adds only new projects and NEVER overwrites an existing one', async () => {
    const summary = await backupData.apply({
      embeddingDimension: 384,
      projects: [project('p1', 'DIFFERENT name'), project('p2')],
      conversations: [conversation('c9')],
      documentsByProject: {},
      generatedImages: [image('imgNew')],
      settings: null,
      preferences: null,
    });
    expect(summary.projectsAdded).toBe(1); // only p2 added
    const ids = useProjectStore.getState().projects.map(p => p.id);
    expect(ids).toEqual(['p1', 'p2']);
    // p1 kept its ORIGINAL name — additive merge never clobbers.
    expect(
      useProjectStore.getState().projects.find(p => p.id === 'p1')!.name,
    ).toBe('original name');
    expect(summary.conversationsAdded).toBe(1);
    expect(useAppStore.getState().generatedImages.map(i => i.id)).toContain(
      'imgNew',
    );
  });

  it('re-applies settings by merge (restore-my-setup), leaving untouched keys intact', async () => {
    const before = useAppStore.getState().settings.systemPrompt;
    await backupData.apply({
      embeddingDimension: 384,
      projects: [],
      conversations: [],
      documentsByProject: {},
      generatedImages: [],
      settings: { temperature: 0.99 },
      preferences: null,
    });
    expect(useAppStore.getState().settings.temperature).toBe(0.99); // applied
    expect(useAppStore.getState().settings.systemPrompt).toBe(before); // untouched key preserved
  });
});
