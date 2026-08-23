import { errorMessage, hasFlag, openExistingDatabase, option, printHeading } from '../lib.js';
import { inspectTaskTimeline } from './queries.js';

function main(): void {
  const taskId = option('--id');
  if (!taskId) throw new Error('Usage: pnpm data:inspect:task -- --id <task-id> [--json]');
  const { database, filename } = openExistingDatabase();
  try {
    const timeline = inspectTaskTimeline(database, taskId);
    if (hasFlag('--json')) {
      console.log(JSON.stringify({ database: filename, ...timeline }, null, 2));
      return;
    }
    printHeading('LifeOS task timeline', filename);
    console.table(timeline.task);
    console.log(`Process events (${timeline.events.length})`);
    console.table(timeline.events);
    console.log(`Conversation messages (${timeline.messages.length})`);
    if (timeline.messages.length > 0) console.table(timeline.messages);
  } finally {
    database.close();
  }
}

try {
  main();
} catch (error) {
  console.error(`Timeline inspection failed: ${errorMessage(error)}`);
  process.exitCode = 1;
}
