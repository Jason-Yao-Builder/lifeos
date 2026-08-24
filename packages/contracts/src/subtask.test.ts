import { describe, expect, it } from 'vitest';
import { CreateSubtaskInputSchema, CreateTaskInputSchema } from './index.js';

describe('subtask contracts', () => {
  it('accepts only client-writable fields for the authoritative subtask endpoint', () => {
    expect(
      CreateSubtaskInputSchema.parse({
        title: 'Child',
        temperature: 'cold',
        plannedDate: '2026-08-25',
      }),
    ).toMatchObject({
      title: 'Child',
      temperature: 'cold',
      plannedDate: '2026-08-25',
    });
    expect(CreateTaskInputSchema.safeParse({ title: 'Root', status: 'completed' }).success)
      .toBe(false);
  });

  it('strictly rejects every server-derived field', () => {
    for (const protectedField of [
      { status: 'todo' },
      { tags: ['client-value'] },
      { parentTaskId: 'client-parent' },
      { groupId: 'client-group' },
    ]) {
      expect(CreateSubtaskInputSchema.safeParse({ title: 'Child', ...protectedField }).success)
        .toBe(false);
    }
  });
});
