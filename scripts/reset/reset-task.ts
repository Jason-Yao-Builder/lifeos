import { errorMessage, hasFlag, openExistingDatabase, option, printHeading } from '../lib.js';
import { planTaskReset, resetTask } from './operations.js';

function main(): void {
  const taskId = option('--id');
  if (!taskId) throw new Error('Usage: pnpm data:reset:task -- --id <task-id> [--confirm]');
  const { database, filename } = openExistingDatabase();
  try {
    printHeading('LifeOS task reset', filename);
    const plan = planTaskReset(database.sqlite, taskId);
    if (!plan.found) throw new Error(`Task not found: ${taskId}`);
    console.log(`Task: ${plan.title} (${plan.taskId})`);
    console.table({
      task: 1,
      cards: plan.cards.length,
      conversations: plan.conversations.length,
      messages: plan.messages,
      events: plan.events,
      retainedAiRuns: plan.retainedAiRuns.length,
    });
    if (plan.retainedAiRuns.length > 0) {
      console.log('Shared AI runs are retained because they may contain other tasks.');
    }

    if (!hasFlag('--confirm')) {
      console.log('Preview only. Nothing was deleted.');
      console.log(`Run \`pnpm data:reset:task -- --id ${taskId} --confirm\` to execute.`);
      return;
    }

    resetTask(database, taskId);
    console.log('Task and its direct cards, conversations, messages, and events were removed.');
  } finally {
    database.close();
  }
}

try {
  main();
} catch (error) {
  console.error(`Task reset failed: ${errorMessage(error)}`);
  process.exitCode = 1;
}
