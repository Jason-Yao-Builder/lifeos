import type { TaskRecord, TaskScoreDimensions } from '@lifeos/contracts';

export type AITask = TaskRecord;

export interface TaskScoreResult {
  taskId: string;
  dimensions: TaskScoreDimensions;
  score: number;
  explanation: string;
}

export interface DailySummaryResult {
  title: string;
  body: string;
  focusTaskIds: string[];
  observations: string[];
  explanation: string;
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatReplyInput {
  messages: AIMessage[];
  tasks?: AITask[];
}

export interface ChatReplyResult {
  content: string;
  explanation: string;
}

export interface StagnationObservation {
  type: 'observation';
  targetTaskId: string;
  title: string;
  body: string;
  daysStale: number;
  explanation: string;
}

export interface DeterministicAIOptions {
  now?: () => Date;
  staleAfterDays?: number;
  timeZone?: string;
}

export interface DeterministicAI {
  readonly provider: 'deterministic';
  readonly model: 'lifeos-rules-v1';
  scoreTask(task: AITask): TaskScoreResult;
  scoreTasks(tasks: AITask[]): TaskScoreResult[];
  dailySummary(tasks: AITask[], date: string): DailySummaryResult;
  reply(input: ChatReplyInput): ChatReplyResult;
  stagnationObservations(tasks: AITask[], staleAfterDays?: number): StagnationObservation[];
}
