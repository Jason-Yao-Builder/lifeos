import { errorMessage, hasFlag, openExistingDatabase, printHeading } from '../lib.js';
import { resetAll, workspaceCounts, type StateCounts } from './operations.js';

function printCounts(label: string, counts: StateCounts): void {
  console.log(label);
  console.table(counts);
}

function main(): void {
  const { database, filename } = openExistingDatabase();
  try {
    printHeading('LifeOS full reset', filename);
    const before = workspaceCounts(database.sqlite);
    printCounts('Current records', before);

    if (!hasFlag('--confirm')) {
      console.log('Preview only. Nothing was deleted.');
      console.log('Run `pnpm data:reset:all -- --confirm` to execute.');
      return;
    }

    const after = resetAll(database);
    printCounts('Records after reset', after);
    console.log('Reset complete. Workspace/user/schema were preserved; three default rules were restored.');
  } finally {
    database.close();
  }
}

try {
  main();
} catch (error) {
  console.error(`Reset failed: ${errorMessage(error)}`);
  process.exitCode = 1;
}
