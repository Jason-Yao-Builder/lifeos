import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTask, createTestHarness, type TestHarness } from './harness.js';

describe('task API', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await createTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('runs CRUD, scoring, history projection, and soft delete', async () => {
    const created = await createTask(harness.app, {
      title: 'Ship API',
      temperature: 'warm',
      deadline: '2026-08-23',
      tags: ['work'],
    });

    expect(created).toMatchObject({
      title: 'Ship API',
      hardness: 'hard',
      deadline: '2026-08-23T23:59:59+08:00',
      version: 2,
    });
    expect(created.score).toEqual(expect.any(Number));

    const listed = await harness.app.inject({ method: 'GET', url: '/api/v1/tasks' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toHaveLength(1);

    const updated = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${created.id}`,
      payload: { version: created.version, patch: { title: 'Ship API v2' } },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ title: 'Ship API v2', version: 3 });

    const events = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${created.id}/events`,
    });
    expect(events.statusCode).toBe(200);
    expect(events.json().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ taskId: created.id, field: 'title' })]),
    );

    const removed = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/tasks/${created.id}?version=${updated.json().version}`,
    });
    expect(removed.statusCode).toBe(204);
    expect(
      (await harness.app.inject({ method: 'GET', url: `/api/v1/tasks/${created.id}` })).statusCode,
    ).toBe(404);
    const retainedEvents = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${created.id}/events`,
    });
    expect(retainedEvents.statusCode).toBe(200);
    expect(retainedEvents.json().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ taskId: created.id })]),
    );
  });

  it('returns the unified 409 envelope for stale versions', async () => {
    const task = await createTask(harness.app, { title: 'Conflict' });
    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}`,
      payload: { version: task.version - 1, patch: { title: 'Stale write' } },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: 'CONFLICT', correlationId: expect.any(String) },
    });
  });

  it('restores completed and archived tasks to todo without losing history', async () => {
    const created = await createTask(harness.app, { title: 'Reopenable task' });
    let current = { version: created.version, status: created.status, completedAt: created.completedAt };
    const move = async (status: string) => {
      const response = await harness.app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${created.id}`,
        payload: { version: current.version, patch: { status } },
      });
      expect(response.statusCode).toBe(200);
      current = response.json();
      return current;
    };

    await move('in_progress');
    const completed = await move('completed');
    expect(completed.completedAt).toEqual(expect.any(String));
    const archived = await move('archived');
    expect(archived.completedAt).toBe(completed.completedAt);
    expect((await move('todo')).completedAt).toBeNull();
    await move('in_progress');
    await move('completed');
    expect((await move('todo')).status).toBe('todo');

    const events = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${created.id}/events`,
    });
    expect(
      events.json().items.filter((event: { field: string }) => event.field === 'status').length,
    ).toBeGreaterThanOrEqual(6);
  });

  it('combines list filters and persists manual ordering with history', async () => {
    const alpha = await createTask(harness.app, {
      title: 'Alpha work',
      temperature: 'hot',
      tags: ['work'],
    });
    const beta = await createTask(harness.app, {
      title: 'Beta personal',
      temperature: 'hot',
      tags: ['personal'],
    });
    const gamma = await createTask(harness.app, {
      title: 'Gamma work',
      temperature: 'warm',
      tags: ['work'],
    });

    const filtered = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/tasks?temperature=hot&status=todo&tag=work&query=Alpha&limit=1',
    });
    expect(filtered.json().items.map((task: { id: string }) => task.id)).toEqual([alpha.id]);

    const reordered = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/tasks/reorder',
      payload: { orderedIds: [gamma.id, beta.id, alpha.id] },
    });
    expect(reordered.statusCode).toBe(200);
    const listed = await harness.app.inject({ method: 'GET', url: '/api/v1/tasks' });
    expect(listed.json().items.map((task: { id: string }) => task.id)).toEqual([
      gamma.id,
      beta.id,
      alpha.id,
    ]);
    const events = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${alpha.id}/events`,
    });
    expect(events.json().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'rank', actor: 'user' })]),
    );
  });

  it('validates temporal invariants at the API boundary', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: {
        title: 'Impossible',
        startAt: '2026-08-23T10:00:00+08:00',
        endAt: '2026-08-23T09:00:00+08:00',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('selects planned, due, and overdue tasks for the requested day', async () => {
    await createTask(harness.app, { title: 'Planned', plannedDate: '2026-08-21' });
    await createTask(harness.app, { title: 'Overdue', deadline: '2026-08-20' });
    await createTask(harness.app, { title: 'Future', plannedDate: '2026-08-22' });

    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/days/2026-08-21' });
    expect(response.statusCode).toBe(200);
    expect(response.json().items.map((task: { title: string }) => task.title)).toEqual([
      'Planned',
      'Overdue',
    ]);
  });
});
