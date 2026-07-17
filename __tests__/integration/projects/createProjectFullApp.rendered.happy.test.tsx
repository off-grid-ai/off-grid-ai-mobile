/** P1 #112 — a project created through the real full-App form survives relaunch. */
import { relaunchMainApp, renderMainApp } from '../../harness/appJourney';

const PROJECT_STORAGE_KEY = 'local-llm-project-storage';
const PROJECT_NAME = 'Offline Research Lab';
const PROJECT_DESCRIPTION = 'Organize private field research and notes';
const PROJECT_INSTRUCTIONS =
  'Help synthesize research notes into concise, evidence-based summaries.';

describe('P1 full-App create-project journey', () => {
  it('creates a complete project and restores its usable list entry after relaunch', async () => {
    const first = await renderMainApp();

    first.rtl.fireEvent.press(first.view.getByTestId('projects-tab'));
    await first.rtl.waitFor(() =>
      expect(
        first.view.getByText(
          'Projects group related chats with shared context and instructions.',
        ),
      ).toBeTruthy(),
    );
    first.rtl.fireEvent.press(first.view.getByText('New'));
    await first.rtl.waitFor(() =>
      expect(first.view.getByText('New Project')).toBeTruthy(),
    );

    first.rtl.fireEvent.changeText(
      first.view.getByPlaceholderText('e.g., Spanish Learning, Code Review'),
      PROJECT_NAME,
    );
    first.rtl.fireEvent.changeText(
      first.view.getByPlaceholderText('Brief description of this project'),
      PROJECT_DESCRIPTION,
    );
    first.rtl.fireEvent.changeText(
      first.view.getByPlaceholderText(
        'Enter the instructions or context for the AI...',
      ),
      PROJECT_INSTRUCTIONS,
    );
    first.rtl.fireEvent.press(first.view.getByText('Save'));

    await first.rtl.waitFor(() => {
      expect(first.view.getAllByText(PROJECT_NAME)).toHaveLength(1);
      expect(first.view.getByText(PROJECT_DESCRIPTION)).toBeTruthy();
      expect(first.view.queryByText('New Project')).toBeNull();
    });

    await first.rtl.waitFor(async () => {
      const persisted = await first.asyncStorage.getItem(PROJECT_STORAGE_KEY);
      expect(persisted).toContain(PROJECT_NAME);
      expect(persisted).toContain(PROJECT_DESCRIPTION);
      expect(persisted).toContain(PROJECT_INSTRUCTIONS);
    });

    first.view.unmount();
    await first.rtl.act(async () => {
      await Promise.resolve();
    });

    const relaunched = await relaunchMainApp();
    relaunched.rtl.fireEvent.press(relaunched.view.getByTestId('projects-tab'));
    await relaunched.rtl.waitFor(() => {
      expect(relaunched.view.getAllByText(PROJECT_NAME)).toHaveLength(1);
      expect(relaunched.view.getByText(PROJECT_DESCRIPTION)).toBeTruthy();
    });

    relaunched.rtl.fireEvent.press(relaunched.view.getByText(PROJECT_NAME));
    await relaunched.rtl.waitFor(() => {
      expect(relaunched.view.getByText(PROJECT_NAME)).toBeTruthy();
      expect(relaunched.view.getByText('Knowledge Base')).toBeTruthy();
      expect(relaunched.view.getByText('No chats yet')).toBeTruthy();
      expect(relaunched.view.queryByText('Project not found')).toBeNull();
    });

    relaunched.view.unmount();
  }, 30000);
});
