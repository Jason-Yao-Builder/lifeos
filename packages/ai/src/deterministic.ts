import { dateTimeToLocalDate, selectTodayTasks } from '@lifeos/domain';
import { scoreTask as calculateScore } from './scoring.js';
import type {
  AITask,
  ChatReplyInput,
  ChatReplyResult,
  DeterministicAI,
  DeterministicAIOptions,
  StagnationObservation,
  TaskScoreResult,
} from './types.js';

const active = (task: AITask): boolean =>
  task.deletedAt === null && !['completed', 'archived', 'abandoned'].includes(task.status);

export function createDeterministicAI(options: DeterministicAIOptions = {}): DeterministicAI {
  const now = options.now ?? (() => new Date());
  const defaultStaleDays = options.staleAfterDays ?? 7;
  const timeZone = options.timeZone ?? 'Asia/Shanghai';
  const scoreOne = (task: AITask): TaskScoreResult => calculateScore(task, now());

  return {
    provider: 'deterministic',
    model: 'lifeos-rules-v1',
    scoreTask: scoreOne,
    scoreTasks(tasks) {
      return tasks.map(scoreOne).sort((a, b) => b.score - a.score || a.taskId.localeCompare(b.taskId));
    },
    dailySummary(tasks, date) {
      const completed = tasks.filter(
        (task) =>
          task.status === 'completed' &&
          task.completedAt !== null &&
          dateTimeToLocalDate(task.completedAt, timeZone) === date,
      );
      const candidates = selectTodayTasks(tasks, { today: date, timeZone });
      const ranked = candidates
        .map((task) => ({ task, result: scoreOne(task) }))
        .sort((a, b) => b.result.score - a.result.score || a.task.rank - b.task.rank);
      const focus = ranked.slice(0, 3);
      const overdue = candidates.filter(
        (task) => task.deadline !== null && new Date(task.deadline).getTime() < now().getTime(),
      );
      const observations = [
        `今日候选 ${candidates.length} 项，已完成 ${completed.length} 项。`,
        ...(overdue.length > 0 ? [`有 ${overdue.length} 项已过截止时间。`] : []),
      ];
      const focusText = focus.length
        ? focus.map(({ task, result }, index) => `${index + 1}. ${task.title}（${result.score} 分）`).join('\n')
        : '今天没有必须推进的任务，可以从温任务中主动挑一项。';
      return {
        title: `${date} 每日计划`,
        body: `${observations.join('')}\n${focusText}`,
        focusTaskIds: focus.map(({ task }) => task.id),
        observations,
        explanation: '候选取今日计划、当天到期和已逾期硬任务，再按透明的四维评分选前三项。',
      };
    },
    reply(input: ChatReplyInput): ChatReplyResult {
      return reply(input, scoreOne);
    },
    stagnationObservations(tasks, staleAfterDays = defaultStaleDays) {
      return stagnation(tasks, now(), staleAfterDays);
    },
  };
}

function reply(
  input: ChatReplyInput,
  scoreOne: (task: AITask) => TaskScoreResult,
): ChatReplyResult {
  const message = [...input.messages].reverse().find((item) => item.role === 'user')?.content ?? '';
  const tasks = (input.tasks ?? []).filter(active);
  const top = tasks
    .map((task) => ({ task, score: scoreOne(task).score }))
    .sort((a, b) => b.score - a.score || a.task.rank - b.task.rank)[0];
  if (!top) {
    return {
      content: '先写下一件具体可执行的事，并给它一个温度；有了任务上下文后我再帮你排序。',
      explanation: '当前没有活跃任务，离线助手避免凭空生成计划。',
    };
  }
  const action = message.includes('拆')
    ? `把「${top.task.title}」拆成一个 30 分钟内能完成的第一步。`
    : message.includes('复盘')
      ? `先说明「${top.task.title}」推进了什么、卡在哪里、下一步是什么。`
      : `优先推进「${top.task.title}」，完成一个明确动作后再重新排序。`;
  return {
    content: action,
    explanation: `选择当前透明评分最高的任务（${top.score} 分），未调用外部模型。`,
  };
}

function stagnation(tasks: AITask[], now: Date, staleAfterDays: number): StagnationObservation[] {
  return tasks.flatMap((task) => {
    if (!active(task)) return [];
    const daysStale = Math.max(0, Math.floor((now.getTime() - new Date(task.updatedAt).getTime()) / 86_400_000));
    if (daysStale < staleAfterDays) return [];
    return [{
      type: 'observation' as const,
      targetTaskId: task.id,
      title: `「${task.title}」已停留 ${daysStale} 天`,
      body: '确认它仍值得推进；若值得，请拆出下一步，否则主动降温或归档。',
      daysStale,
      explanation: `updatedAt 距当前时间达到阈值 ${staleAfterDays} 天。`,
    }];
  });
}
