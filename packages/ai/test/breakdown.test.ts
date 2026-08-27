import { describe, expect, it } from 'vitest';
import { compileTaskBreakdown, type PlanTask } from '../src/index.js';

const parent: PlanTask = {
  id: 'parent', title: 'Launch product', status: 'todo', deadline: null,
  plannedDate: null, estimatedMinutes: 180, actualMinutes: 0, goalId: 'goal',
  parentTaskId: null, rank: 0, version: 3, createdAt: '2026-08-01T00:00:00.000Z',
  deletedAt: null,
};

describe('task breakdown compiler', () => {
  it('compiles executable subtasks with an auditable dependency graph', () => {
    const result = compileTaskBreakdown(parent, {
      parentTaskId: parent.id,
      parentVersion: parent.version,
      objective: '让用户可以完成一次端到端发布',
      subtasks: [
        {
          clientId: 'design', title: '确认发布清单',
          definitionOfDone: '清单逐项写明负责人和验收条件', estimatedMinutes: 30,
        },
        {
          clientId: 'ship', title: '执行发布',
          definitionOfDone: '生产版本部署成功且健康检查通过', estimatedMinutes: 60,
          dependsOn: ['design'],
        },
      ],
    });

    expect(result.status).toBe('ready');
    expect(result.subtasks).toHaveLength(2);
    expect(result.dependencies).toEqual([
      { predecessorClientId: 'design', successorClientId: 'ship' },
    ]);
    expect(result.subtasks.every((item) => item.description.length > 0)).toBe(true);
  });

  it('rejects vague, oversized, duplicate, unknown, and cyclic drafts', () => {
    const result = compileTaskBreakdown(parent, {
      parentTaskId: parent.id,
      parentVersion: 2,
      objective: '做完',
      subtasks: [
        {
          clientId: 'same', title: '重复', definitionOfDone: '', estimatedMinutes: 500,
          dependsOn: ['same'],
        },
        {
          clientId: 'same', title: '重复', definitionOfDone: '完成', estimatedMinutes: 5,
          dependsOn: ['missing'],
        },
      ],
    });

    expect(result.status).toBe('rejected');
    expect(result.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      'STALE_PARENT',
      'INVALID_OBJECTIVE',
      'DUPLICATE_SUBTASK',
      'INVALID_SUBTASK',
      'UNKNOWN_SUBTASK_DEPENDENCY',
      'SUBTASK_DEPENDENCY_CYCLE',
    ]));
  });
});
