import { hasDependencyCycle } from '@lifeos/domain';
import type { PlanTask } from './adaptive-types.js';

export interface BreakdownSubtaskDraft {
  clientId: string;
  title: string;
  definitionOfDone: string;
  estimatedMinutes: number;
  dependsOn?: readonly string[] | undefined;
}

export interface TaskBreakdownDraft {
  parentTaskId: string;
  parentVersion: number;
  objective: string;
  subtasks: readonly BreakdownSubtaskDraft[];
}

export type BreakdownIssueCode =
  | 'STALE_PARENT'
  | 'INACTIVE_PARENT'
  | 'INVALID_OBJECTIVE'
  | 'INVALID_SUBTASK_COUNT'
  | 'INVALID_SUBTASK'
  | 'DUPLICATE_SUBTASK'
  | 'UNKNOWN_SUBTASK_DEPENDENCY'
  | 'SUBTASK_DEPENDENCY_CYCLE';

export interface BreakdownIssue {
  code: BreakdownIssueCode;
  clientIds: string[];
  message: string;
}

export interface CompiledSubtask {
  clientId: string;
  parentTaskId: string;
  title: string;
  description: string;
  estimatedMinutes: number;
  rank: number;
}

export interface TaskBreakdownProposal {
  kind: 'task-breakdown';
  schemaVersion: 1;
  status: 'ready' | 'rejected';
  parentTaskId: string;
  parentVersion: number;
  objective: string;
  subtasks: CompiledSubtask[];
  dependencies: Array<{ predecessorClientId: string; successorClientId: string }>;
  issues: BreakdownIssue[];
  explanation: string;
}

const normalized = (value: string): string => value.trim().toLocaleLowerCase();

export function compileTaskBreakdown(
  parent: PlanTask,
  draft: TaskBreakdownDraft,
): TaskBreakdownProposal {
  const issues: BreakdownIssue[] = [];
  if (parent.id !== draft.parentTaskId || parent.version !== draft.parentVersion) {
    issues.push({ code: 'STALE_PARENT', clientIds: [], message: '父任务版本已变化。' });
  }
  if (parent.deletedAt !== null || !['todo', 'in_progress'].includes(parent.status)) {
    issues.push({ code: 'INACTIVE_PARENT', clientIds: [], message: '只能拆解活跃任务。' });
  }
  const objective = draft.objective.trim();
  if (objective.length < 5 || objective.length > 1_000) {
    issues.push({ code: 'INVALID_OBJECTIVE', clientIds: [], message: '拆解目标必须清晰且不超过 1000 字。' });
  }
  if (draft.subtasks.length < 2 || draft.subtasks.length > 12) {
    issues.push({ code: 'INVALID_SUBTASK_COUNT', clientIds: [], message: '每次拆解应包含 2 到 12 个子任务。' });
  }
  const ids = draft.subtasks.map((item) => item.clientId);
  const titles = draft.subtasks.map((item) => normalized(item.title));
  const duplicates = draft.subtasks.filter((item, index) =>
    ids.indexOf(item.clientId) !== index || titles.indexOf(normalized(item.title)) !== index,
  ).map((item) => item.clientId);
  if (duplicates.length > 0) {
    issues.push({
      code: 'DUPLICATE_SUBTASK', clientIds: [...new Set(duplicates)],
      message: '子任务标识和标题必须唯一。',
    });
  }
  for (const item of draft.subtasks) {
    if (
      !item.clientId.trim() || item.clientId.length > 100 ||
      !item.title.trim() || item.title.trim().length > 200 ||
      !item.definitionOfDone.trim() || item.definitionOfDone.trim().length > 1_000 ||
      !Number.isInteger(item.estimatedMinutes) ||
      item.estimatedMinutes < 5 || item.estimatedMinutes > 240
    ) {
      issues.push({
        code: 'INVALID_SUBTASK', clientIds: [item.clientId],
        message: '子任务需包含标题、完成定义和 5 到 240 分钟的估时。',
      });
    }
  }
  const knownIds = new Set(ids);
  const dependencies = draft.subtasks.flatMap((item) =>
    (item.dependsOn ?? []).map((predecessorClientId) => ({
      predecessorClientId,
      successorClientId: item.clientId,
    })),
  );
  const unknown = [...new Set(dependencies.flatMap((edge) =>
    [edge.predecessorClientId, edge.successorClientId].filter((id) => !knownIds.has(id)),
  ))];
  if (unknown.length > 0) {
    issues.push({
      code: 'UNKNOWN_SUBTASK_DEPENDENCY', clientIds: unknown,
      message: '子任务依赖引用了未知标识。',
    });
  }
  if (hasDependencyCycle(dependencies.map((edge) => ({
    predecessorId: edge.predecessorClientId,
    successorId: edge.successorClientId,
  })))) {
    issues.push({
      code: 'SUBTASK_DEPENDENCY_CYCLE', clientIds: [], message: '子任务依赖不能形成循环。',
    });
  }
  const status = issues.length === 0 ? 'ready' : 'rejected';
  return {
    kind: 'task-breakdown', schemaVersion: 1, status,
    parentTaskId: draft.parentTaskId, parentVersion: draft.parentVersion, objective,
    subtasks: draft.subtasks.map((item, rank) => ({
      clientId: item.clientId, parentTaskId: parent.id, title: item.title.trim(),
      description: item.definitionOfDone.trim(), estimatedMinutes: item.estimatedMinutes, rank,
    })),
    dependencies, issues,
    explanation: status === 'ready'
      ? `拆解为 ${draft.subtasks.length} 个具有完成定义的可执行子任务，等待确认。`
      : '拆解草案未通过确定性校验，不可执行。',
  };
}

export function validateTaskBreakdownForCommit(
  value: unknown,
  parent: PlanTask,
): { success: true; proposal: TaskBreakdownProposal } | { success: false; issues: BreakdownIssue[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { success: false, issues: [{
      code: 'INVALID_SUBTASK', clientIds: [], message: '拆解提案结构无效。',
    }] };
  }
  const item = value as Record<string, unknown>;
  if (
    item.kind !== 'task-breakdown' || item.schemaVersion !== 1 || item.status !== 'ready' ||
    typeof item.parentTaskId !== 'string' || !Number.isInteger(item.parentVersion) ||
    typeof item.objective !== 'string' || !Array.isArray(item.subtasks) ||
    !Array.isArray(item.dependencies)
  ) {
    return { success: false, issues: [{
      code: 'INVALID_SUBTASK', clientIds: [], message: '拆解提案结构无效或未通过预检。',
    }] };
  }
  const dependencies = item.dependencies as Array<Record<string, unknown>>;
  const subtasks = (item.subtasks as Array<Record<string, unknown>>).map((subtask) => ({
    clientId: typeof subtask.clientId === 'string' ? subtask.clientId : '',
    title: typeof subtask.title === 'string' ? subtask.title : '',
    definitionOfDone: typeof subtask.description === 'string' ? subtask.description : '',
    estimatedMinutes: typeof subtask.estimatedMinutes === 'number' ? subtask.estimatedMinutes : 0,
    dependsOn: dependencies
      .filter((edge) => edge.successorClientId === subtask.clientId)
      .map((edge) => typeof edge.predecessorClientId === 'string' ? edge.predecessorClientId : ''),
  }));
  const compiled = compileTaskBreakdown(parent, {
    parentTaskId: item.parentTaskId,
    parentVersion: item.parentVersion as number,
    objective: item.objective,
    subtasks,
  });
  return compiled.status === 'ready'
    ? { success: true, proposal: compiled }
    : { success: false, issues: compiled.issues };
}
