import type { DeliveryResult, ImportSummary } from '../../services/backup';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Human-readable result of writing/delivering a backup file. Pure. */
export const formatDeliveryMessage = (result: DeliveryResult): string =>
  result.method === 'shared'
    ? 'Your backup is ready. Choose where to save or send it.'
    : `Saved to ${result.location}. You can move or copy it anywhere from your Files app.`;

/** Human-readable summary of a restore. Pure, so it is directly testable. */
export const formatImportSummary = (summary: ImportSummary): string => {
  const lines = [
    `${plural(summary.projectsAdded, 'project')} added`,
    `${plural(summary.conversationsAdded, 'conversation')} added`,
  ];
  if (summary.documentsImported > 0) lines.push(`${plural(summary.documentsImported, 'document')} restored`);
  if (summary.documentsSkipped > 0) lines.push(`${plural(summary.documentsSkipped, 'document')} already present`);
  let message = lines.join('\n');
  if (summary.kbErrors.length > 0) {
    message +=
      '\n\nSome knowledge bases could not be restored because the embedding model was not available. Your projects and conversations were restored.';
  }
  return message;
};
