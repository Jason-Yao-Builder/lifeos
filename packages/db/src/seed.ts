import { rules, users, workspaces } from './schema.js';
import type { SqliteDatabase } from './store/runtime.js';
import { DEFAULT_TENANT_ID, DEFAULT_USER_ID } from './types.js';

export function seedDefaults(db: SqliteDatabase, now: () => Date = () => new Date()): void {
  const createdAt = now().toISOString();
  db.transaction((tx) => {
    tx.insert(workspaces)
      .values({
        id: DEFAULT_TENANT_ID,
        name: 'Local Workspace',
        timezone: 'Asia/Shanghai',
        createdAt,
      })
      .onConflictDoNothing()
      .run();
    tx.insert(users)
      .values({
        id: DEFAULT_USER_ID,
        workspaceId: DEFAULT_TENANT_ID,
        displayName: 'Local User',
        createdAt,
      })
      .onConflictDoNothing()
      .run();
    const presets = [
      {
        id: 'deadline-auto-heat',
        name: 'Deadline 前自动升温',
        trigger: { type: 'daily' },
        condition: { field: 'deadline', op: 'within_days', value: 3 },
        action: { type: 'change_temperature', value: 'hot', requireConfirmation: false },
        config: { days: 3 },
      },
      {
        id: 'stale-task-observation',
        name: '滞留任务观察',
        trigger: { type: 'daily' },
        condition: { field: 'updatedAt', op: 'older_than_days', value: 7 },
        action: {
          type: 'create_card',
          cardType: 'observation',
          title: '任务滞留提醒',
          body: '请确认继续推进、拆解、降温或归档。',
          requireConfirmation: true,
        },
        config: { days: 7 },
      },
      {
        id: 'friday-hot-demotion',
        name: '周五未完成热任务降温',
        trigger: { type: 'weekly', weekday: 5 },
        condition: { temperature: 'hot', status: ['todo', 'in_progress'] },
        action: { type: 'change_temperature', value: 'warm', requireConfirmation: true },
        config: {},
      },
    ];
    for (const preset of presets) {
      tx.insert(rules)
        .values({
          id: preset.id,
          workspaceId: DEFAULT_TENANT_ID,
          name: preset.name,
          triggerJson: JSON.stringify(preset.trigger),
          conditionJson: JSON.stringify(preset.condition),
          actionJson: JSON.stringify(preset.action),
          configJson: JSON.stringify(preset.config),
          createdAt,
          updatedAt: createdAt,
        })
        .onConflictDoNothing()
        .run();
    }
  });
}
