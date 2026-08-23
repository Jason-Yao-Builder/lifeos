import { errorMessage, hasFlag, openExistingDatabase, positiveIntegerOption, printHeading } from '../lib.js';
import { inspectState } from './queries.js';

function main(): void {
  const limit = Math.min(positiveIntegerOption('--limit', 20), 500);
  const { database, filename } = openExistingDatabase();
  try {
    const state = inspectState(database, limit);
    if (hasFlag('--json')) {
      console.log(JSON.stringify({ database: filename, ...state }, null, 2));
      return;
    }
    printHeading('LifeOS state snapshot', filename);
    console.table({
      tasks: state.tasks.total,
      activeTasks: state.tasks.active,
      softDeletedTasks: state.tasks.softDeleted,
      cards: state.cards.total,
      conversations: state.conversations,
      messages: state.messages,
      aiRuns: state.aiRuns.total,
      rules: state.rules.total,
      enabledRules: state.rules.enabled,
      events: state.events.total,
    });
    console.log('Tasks by status');
    console.table(state.tasks.byStatus);
    console.log('Tasks by temperature');
    console.table(state.tasks.byTemperature);
    console.log(`Recent ${state.tasks.recent.length} tasks`);
    console.table(state.tasks.recent);
    console.log(`Recent ${state.events.recent.length} events`);
    console.table(state.events.recent);
  } finally {
    database.close();
  }
}

try {
  main();
} catch (error) {
  console.error(`Inspection failed: ${errorMessage(error)}`);
  process.exitCode = 1;
}
