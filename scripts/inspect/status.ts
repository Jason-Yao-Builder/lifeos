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
      taskGroups: state.taskGroups.total,
      activeTasks: state.tasks.active,
      softDeletedTasks: state.tasks.softDeleted,
      cards: state.cards.total,
      conversations: state.conversations,
      messages: state.messages,
      taskImages: state.taskImages.count,
      taskImageBytes: state.taskImages.totalBytes,
      aiRuns: state.aiRuns.total,
      rules: state.rules.total,
      enabledRules: state.rules.enabled,
      goals: state.goals.total,
      dependencies: state.dependencies,
      repeatTemplates: state.repeatTemplates.total,
      enabledRepeatTemplates: state.repeatTemplates.enabled,
      reviews: state.reviews.total,
      events: state.events.total,
    });
    if (!state.taskImages.available) console.warn(state.taskImages.migrationHint);
    console.log('Tasks by status');
    console.table(state.tasks.byStatus);
    console.log('Tasks by temperature');
    console.table(state.tasks.byTemperature);
    console.log(`Recent ${state.taskGroups.recent.length} task groups`);
    console.table(state.taskGroups.recent);
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
