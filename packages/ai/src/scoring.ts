import type { AITask, TaskScoreResult } from './types.js';
import { calculateTaskScore } from '@lifeos/domain';

const impactByTemperature = { hot: 90, warm: 72, cold: 45, inspiration: 35 } as const;
const alignmentByTemperature = { hot: 90, warm: 75, cold: 55, inspiration: 40 } as const;

function urgency(task: AITask, now: Date): number {
  if (!task.deadline) return task.temperature === 'hot' ? 60 : 35;
  const days = (new Date(task.deadline).getTime() - now.getTime()) / 86_400_000;
  if (days < 0) return 100;
  if (days <= 1) return 95;
  if (days <= 3) return 85;
  if (days <= 7) return 70;
  if (days <= 30) return 50;
  return 35;
}

function effortCost(estimatedMinutes: number | null): number {
  if (estimatedMinutes === null) return 50;
  if (estimatedMinutes <= 30) return 10;
  if (estimatedMinutes <= 60) return 25;
  if (estimatedMinutes <= 120) return 45;
  if (estimatedMinutes <= 240) return 65;
  return 85;
}

export function scoreTask(task: AITask, now: Date): TaskScoreResult {
  const dimensions = {
    impact: impactByTemperature[task.temperature],
    urgency: urgency(task, now),
    alignment: alignmentByTemperature[task.temperature],
    effort: effortCost(task.estimatedMinutes),
  };
  const score = calculateTaskScore(dimensions).score;
  const deadlineReason = task.deadline ? `截止时间使紧迫度为 ${dimensions.urgency}` : '无截止时间';
  return {
    taskId: task.id,
    dimensions,
    score,
    explanation: `温度 ${task.temperature} 决定影响与方向分；${deadlineReason}；预估时长是成本，越长 effort 越高。`,
  };
}
