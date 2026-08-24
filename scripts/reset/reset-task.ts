import {
  errorMessage,
  hasFlag,
  openExistingDatabase,
  option,
  printHeading,
  TASK_IMAGES_MIGRATION_HINT,
} from '../lib.js';
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
      dependencies: plan.dependencies.length,
      messages: plan.messages,
      events: plan.events,
      taskImages: plan.taskImages,
      taskImageBytes: plan.taskImageBytes,
      retainedAiRuns: plan.retainedAiRuns.length,
    });
    if (!plan.taskImagesAvailable) console.warn(TASK_IMAGES_MIGRATION_HINT);
    if (plan.retainedAiRuns.length > 0) {
      console.log('Shared AI runs are retained because they may contain other tasks.');
    }

    if (!hasFlag('--confirm')) {
      console.log('Preview only. Nothing was deleted.');
      console.log(`Run \`pnpm data:reset:task -- --id ${taskId} --confirm\` to execute.`);
      return;
    }

    const result = resetTask(database, taskId);
    console.table({
      removedTaskImages: result.taskImages,
      removedTaskImageBytes: result.taskImageBytes,
    });
    console.log('Task and its direct dependencies, cards, conversations, messages, and events were removed.');
    if (result.taskImagesAvailable) {
      console.log('Task images were removed by the task foreign-key cascade.');
    }
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
