import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTask, createTestHarness, type TestHarness } from './harness.js';

describe('v0.2 structure and timeline API', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await createTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('manages goals and calculates inherited subtask progress', async () => {
    const goalResponse = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/goals',
      payload: { title: 'Launch v0.2', timeframe: '2026-09' },
    });
    expect(goalResponse.statusCode).toBe(201);
    const goal = goalResponse.json();
    const parent = await createTask(harness.app, { title: 'Parent', goalId: goal.id });
    const children = [];
    for (const title of ['Design', 'Build', 'Ship']) {
      const response = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${parent.id}/subtasks`,
        payload: { title },
      });
      expect(response.statusCode).toBe(201);
      children.push(response.json());
    }
    for (const child of children.slice(0, 2)) {
      const started = await patchTask(harness, child.id, child.version, { status: 'in_progress' });
      await patchTask(harness, child.id, started.version, { status: 'completed' });
    }

    const progress = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${parent.id}/progress`,
    });
    expect(progress.json()).toEqual({ completed: 2, total: 3, percent: 67 });
    const subtasks = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${parent.id}/subtasks`,
    });
    expect(subtasks.json().items).toHaveLength(3);
    expect(subtasks.json().items.every((task: { goalId: string }) => task.goalId === goal.id)).toBe(true);

    const goalProgress = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/goals/${goal.id}/progress`,
    });
    expect(goalProgress.statusCode).toBe(200);
    expect(goalProgress.json()).toMatchObject({ completed: 2, total: 4, percent: 50 });
  });

  it('rejects dependency cycles, exposes blocking, and calculates the critical path', async () => {
    const a = await createTask(harness.app, {
      title: 'A',
      startAt: '2026-08-21T00:00:00+08:00',
      endAt: '2026-08-22T23:59:59+08:00',
    });
    const b = await createTask(harness.app, {
      title: 'B',
      startAt: '2026-08-23T00:00:00+08:00',
      endAt: '2026-08-24T23:59:59+08:00',
    });
    const c = await createTask(harness.app, {
      title: 'C',
      startAt: '2026-08-25T00:00:00+08:00',
      endAt: '2026-08-26T23:59:59+08:00',
    });
    expect((await addDependency(harness, b.id, a.id)).statusCode).toBe(201);
    expect((await addDependency(harness, c.id, b.id)).statusCode).toBe(201);

    const blocked = await harness.app.inject({ method: 'GET', url: `/api/v1/tasks/${b.id}` });
    expect(blocked.json().isBlocked).toBe(true);
    const cycle = await addDependency(harness, a.id, c.id);
    expect(cycle.statusCode).toBe(409);
    expect(cycle.json().error.code).toBe('CONFLICT');

    const gantt = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/gantt?start=2026-08-20&end=2026-08-30',
    });
    expect(gantt.statusCode).toBe(200);
    expect(gantt.json().dependencies).toHaveLength(2);
    expect(gantt.json().criticalPath).toEqual([a.id, b.id, c.id]);
    expect(gantt.json().tasks.find((task: { id: string }) => task.id === b.id)).toMatchObject({
      isBlocked: true,
    });
  });

  it('reschedules calendar tasks and edits Gantt timespans with versions', async () => {
    const task = await createTask(harness.app, {
      title: 'Calendar task',
      plannedDate: '2026-08-21',
      deadline: '2026-08-22',
      startAt: '2026-08-21T00:00:00+08:00',
      endAt: '2026-08-22T23:59:59+08:00',
    });
    const calendar = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/calendar?start=2026-08-01&end=2026-08-31&view=month',
    });
    expect(calendar.statusCode).toBe(200);
    expect(calendar.json().days['2026-08-21'].tasks[0].id).toBe(task.id);
    expect(calendar.json().days['2026-08-22'].deadlineTasks[0].id).toBe(task.id);

    const rescheduled = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}/reschedule`,
      payload: {
        version: task.version,
        plannedDate: '2026-08-23',
        startAt: '2026-08-21T00:00:00+08:00',
        endAt: '2026-08-22T23:59:59+08:00',
      },
    });
    expect(rescheduled.statusCode).toBe(200);
    expect(rescheduled.json()).toMatchObject({ plannedDate: '2026-08-23' });
    const stretched = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}/timespan`,
      payload: {
        version: rescheduled.json().version,
        startAt: '2026-08-21T00:00:00+08:00',
        endAt: '2026-08-24T23:59:59+08:00',
      },
    });
    expect(stretched.statusCode).toBe(200);
    expect(stretched.json().endAt).toBe('2026-08-24T23:59:59+08:00');
    const extended = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}/timespan`,
      payload: {
        version: stretched.json().version,
        startsAt: '2026-08-21T00:00:00+08:00',
        endsAt: '2026-08-26T23:59:59+08:00',
      },
    });
    expect(extended.statusCode).toBe(200);
    expect(extended.json().endAt).toBe('2026-08-26T23:59:59+08:00');
    const stale = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}/timespan`,
      payload: {
        version: stretched.json().version,
        startAt: '2026-08-21T00:00:00+08:00',
        endAt: '2026-08-27T23:59:59+08:00',
      },
    });
    expect(stale.statusCode).toBe(409);
    const gantt = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/gantt?start=2026-08-01&end=2026-08-31',
    });
    expect(gantt.json().tasks.find((item: { id: string }) => item.id === task.id).endsAt)
      .toBe('2026-08-26T23:59:59+08:00');
    const refreshed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/calendar?start=2026-08-01&end=2026-08-31&view=month',
    });
    expect(refreshed.json().days['2026-08-23'].tasks[0].id).toBe(task.id);
  });

  it('filters Gantt spans by the configured workspace timezone', async () => {
    const shanghaiBoundary = await createTask(harness.app, {
      title: 'Shanghai boundary',
      startAt: '2026-08-23T17:00:00.000Z',
      endAt: '2026-08-23T18:00:00.000Z',
    });
    const shanghaiPlanned = await createTask(harness.app, {
      title: 'Shanghai planned fallback',
      plannedDate: '2026-08-24',
    });
    const explicitSpan = await createTask(harness.app, {
      title: 'Explicit span wins over planned date',
      plannedDate: '2026-08-24',
      startAt: '2026-08-25T01:00:00+08:00',
      endAt: '2026-08-25T02:00:00+08:00',
    });
    const shanghaiDay = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/gantt?start=2026-08-24&end=2026-08-24',
    });
    expect(shanghaiDay.statusCode).toBe(200);
    expect(shanghaiDay.json().tasks.map((task: { id: string }) => task.id))
      .toContain(shanghaiBoundary.id);
    expect(shanghaiDay.json().tasks.find((task: { id: string }) => task.id === shanghaiPlanned.id))
      .toMatchObject({
        startsAt: '2026-08-24T00:00:00+08:00',
        endsAt: '2026-08-24T23:59:59+08:00',
      });
    expect(shanghaiDay.json().tasks.map((task: { id: string }) => task.id))
      .not.toContain(explicitSpan.id);
    const shanghaiPreviousDay = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/gantt?start=2026-08-23&end=2026-08-23',
    });
    expect(shanghaiPreviousDay.json().tasks.map((task: { id: string }) => task.id))
      .not.toContain(shanghaiBoundary.id);

    const losAngeles = await createTestHarness({ timeZone: 'America/Los_Angeles' });
    try {
      const laBoundary = await createTask(losAngeles.app, {
        title: 'Los Angeles boundary',
        startAt: '2026-08-24T02:00:00.000Z',
        endAt: '2026-08-24T03:00:00.000Z',
      });
      const laPlanned = await createTask(losAngeles.app, {
        title: 'Los Angeles planned fallback',
        plannedDate: '2026-08-24',
      });
      const laPreviousDay = await losAngeles.app.inject({
        method: 'GET',
        url: '/api/v1/gantt?start=2026-08-23&end=2026-08-23',
      });
      expect(laPreviousDay.statusCode).toBe(200);
      expect(laPreviousDay.json().tasks.map((task: { id: string }) => task.id))
        .toContain(laBoundary.id);
      const laDay = await losAngeles.app.inject({
        method: 'GET',
        url: '/api/v1/gantt?start=2026-08-24&end=2026-08-24',
      });
      expect(laDay.json().tasks.map((task: { id: string }) => task.id))
        .not.toContain(laBoundary.id);
      expect(laDay.json().tasks.find((task: { id: string }) => task.id === laPlanned.id))
        .toMatchObject({
          startsAt: '2026-08-24T00:00:00-07:00',
          endsAt: '2026-08-24T23:59:59-07:00',
        });
    } finally {
      await losAngeles.close();
    }
  });

  it('generates independent repeat instances across a 28-day horizon', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/repeat-templates',
      payload: {
        title: 'Weekday standup',
        cronExpr: '0 9 * * 1-5',
        timezone: 'Asia/Shanghai',
      },
    });
    expect(created.statusCode).toBe(201);
    const template = created.json();
    const generated = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/repeat-templates/${template.id}/generate`,
      payload: {},
    });
    expect(generated.statusCode).toBe(200);
    const items = generated.json().items;
    expect(items).toHaveLength(20);
    expect(items.every((task: { repeatTemplateId: string }) => task.repeatTemplateId === template.id)).toBe(true);
    const renamed = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/repeat-templates/${template.id}`,
      payload: { title: 'Renamed standup' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().lastGenerated).toBe('2026-09-17');
    const tasks = await harness.app.inject({ method: 'GET', url: '/api/v1/tasks?limit=500' });
    expect(tasks.json().items.filter((task: { repeatTemplateId: string }) => task.repeatTemplateId === template.id))
      .toHaveLength(20);
    expect(tasks.json().items.some((task: { title: string }) => task.title === 'Renamed standup')).toBe(false);
  });

  it('runs morning planning, carry-over, and daily review end to end', async () => {
    const first = await createTask(harness.app, { title: 'Carry today', plannedDate: '2026-08-20' });
    const second = await createTask(harness.app, { title: 'Move later', plannedDate: '2026-08-20' });
    const morning = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/days/2026-08-21/morning',
    });
    expect(morning.statusCode).toBe(200);
    expect(morning.json().unfinished).toHaveLength(2);

    const carryover = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/days/2026-08-21/carryover',
      payload: {
        decisions: [
          { taskId: first.id, action: 'carry_today' },
          { taskId: second.id, action: 'reschedule', targetDate: '2026-08-23' },
        ],
      },
    });
    expect(carryover.statusCode).toBe(200);
    expect(carryover.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, plannedDate: '2026-08-21' }),
        expect.objectContaining({ id: second.id, plannedDate: '2026-08-23' }),
      ]),
    );

    const plan = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/reviews/daily-plan',
      payload: {
        date: '2026-08-21',
        plannedTaskIds: [first.id],
        carryoverDecisions: [{ taskId: first.id, action: 'carry_today' }],
      },
    });
    expect(plan.statusCode).toBe(200);
    expect(plan.json()).toMatchObject({ type: 'daily_plan', periodStart: '2026-08-21' });
    expect(plan.json().content.plannedTasks).toEqual([{ taskId: first.id, title: 'Carry today' }]);

    const carriedTask = carryover.json().items.find((task: { id: string }) => task.id === first.id);
    const started = await patchTask(harness, first.id, carriedTask.version, { status: 'in_progress' });
    await patchTask(harness, first.id, started.version, { status: 'completed' });
    const review = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/reviews/daily-review',
      payload: { date: '2026-08-21', incompleteReasons: [] },
    });
    expect(review.statusCode).toBe(200);
    expect(review.json().content).toMatchObject({ completionRate: 100 });

    const weekly = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/reviews/weekly',
      payload: { date: '2026-08-21' },
    });
    expect(weekly.statusCode).toBe(200);
    expect(weekly.json()).toMatchObject({ type: 'weekly_review' });
    const monthly = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/reviews/monthly',
      payload: { date: '2026-08-21' },
    });
    expect(monthly.statusCode).toBe(200);
    expect(monthly.json()).toMatchObject({ type: 'monthly_review' });
  });

  it('calculates a 67 percent daily review and requires reasons in the UI contract', async () => {
    const planned = await Promise.all(
      ['Write', 'Review', 'Publish'].map((title) =>
        createTask(harness.app, { title, plannedDate: '2026-08-21' }),
      ),
    );
    const plan = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/reviews/daily-plan',
      payload: { date: '2026-08-21', plannedTaskIds: planned.map((task) => task.id) },
    });
    expect(plan.statusCode).toBe(200);

    for (const task of planned.slice(0, 2)) {
      const started = await patchTask(harness, task.id, task.version, { status: 'in_progress' });
      await patchTask(harness, task.id, started.version, { status: 'completed' });
    }
    const review = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/reviews/daily-review',
      payload: {
        date: '2026-08-21',
        incompleteReasons: [{ taskId: planned[2]!.id, reason: '等待外部反馈' }],
      },
    });
    expect(review.statusCode).toBe(200);
    expect(review.json().content).toMatchObject({
      completionRate: 67,
      incompleteReasons: [{ taskId: planned[2]!.id, reason: '等待外部反馈' }],
    });
    expect(review.json().content.plannedTasks.filter((task: { completed: boolean }) => task.completed))
      .toHaveLength(2);
  });

  it('builds a seven-day completion-rate trend and weekly goal aggregation', async () => {
    const goalResponse = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/goals',
      payload: { title: 'Weekly goal' },
    });
    const goal = goalResponse.json();
    const dates = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'];
    for (const [index, date] of dates.entries()) {
      const task = await createTask(harness.app, { title: `Day ${index + 1}`, plannedDate: date, goalId: goal.id });
      await harness.app.inject({
        method: 'POST',
        url: '/api/v1/reviews/daily-plan',
        payload: { date, plannedTaskIds: [task.id] },
      });
      if (index < 5) await completeTask(harness, task);
      const review = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/reviews/daily-review',
        payload: {
          date,
          incompleteReasons: index < 5 ? [] : [{ taskId: task.id, reason: '顺延' }],
        },
      });
      expect(review.statusCode).toBe(200);
    }
    const weekly = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/reviews/weekly',
      payload: { date: '2026-08-21' },
    });
    expect(weekly.statusCode).toBe(200);
    expect(weekly.json().content).toMatchObject({
      plannedCount: 7,
      completedCount: 5,
      completionRate: 71,
      dailyCompletionRates: dates.map((date, index) => ({ date, rate: index < 5 ? 100 : 0 })),
    });
    expect(weekly.json().content.goals.find((item: { goalId: string }) => item.goalId === goal.id).completedTaskIds)
      .toHaveLength(5);
  });

  it('derives weekly temperature changes from events inside the requested week', async () => {
    harness.now.setTime(new Date('2026-08-10T09:00:00+08:00').getTime());
    const outside = await createTask(harness.app, { title: 'Earlier change', temperature: 'cold' });
    await patchTask(harness, outside.id, outside.version, { temperature: 'hot' });

    harness.now.setTime(new Date('2026-08-18T09:00:00+08:00').getTime());
    const heated = await createTask(harness.app, { title: 'Heated', temperature: 'cold' });
    await patchTask(harness, heated.id, heated.version, { temperature: 'hot' });
    const cooled = await createTask(harness.app, { title: 'Cooled', temperature: 'hot' });

    harness.now.setTime(new Date('2026-08-20T09:00:00+08:00').getTime());
    await patchTask(harness, cooled.id, cooled.version, { temperature: 'cold' });
    const weekly = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/reviews/weekly',
      payload: { date: '2026-08-21' },
    });

    expect(weekly.statusCode).toBe(200);
    expect(weekly.json().content.temperatureChanges).toEqual({
      heatedTaskIds: [heated.id],
      cooledTaskIds: [cooled.id],
    });
    expect(weekly.json().content.temperatureChanges.heatedTaskIds).not.toContain(outside.id);
  });

  it('builds the monthly temperature distribution as clipped calendar weeks', async () => {
    harness.now.setTime(new Date('2026-08-01T09:00:00+08:00').getTime());
    const task = await createTask(harness.app, { title: 'Temperature history', temperature: 'cold' });

    harness.now.setTime(new Date('2026-08-10T09:00:00+08:00').getTime());
    const heated = await patchTask(harness, task.id, task.version, { temperature: 'hot' });
    harness.now.setTime(new Date('2026-08-20T09:00:00+08:00').getTime());
    await patchTask(harness, task.id, heated.version, { temperature: 'warm' });

    const monthly = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/reviews/monthly',
      payload: { date: '2026-08-31' },
    });
    expect(monthly.statusCode).toBe(200);
    expect(monthly.json().content.temperatureTrend).toEqual([
      temperaturePoint('2026-08-01', '2026-08-02', 'cold'),
      temperaturePoint('2026-08-03', '2026-08-09', 'cold'),
      temperaturePoint('2026-08-10', '2026-08-16', 'hot'),
      temperaturePoint('2026-08-17', '2026-08-23', 'warm'),
      temperaturePoint('2026-08-24', '2026-08-30', 'warm'),
      temperaturePoint('2026-08-31', '2026-08-31', 'warm'),
    ]);
  });

  it('limits repeat completion and carry-over rankings to the reviewed month', async () => {
    harness.now.setTime(new Date('2026-08-01T09:00:00+08:00').getTime());
    const templateResponse = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/repeat-templates',
      payload: { title: 'Monday routine', cronExpr: '0 9 * * 1' },
    });
    const generation = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/repeat-templates/${templateResponse.json().id}/generate`,
      payload: { throughDate: '2026-09-07' },
    });
    expect(generation.statusCode).toBe(200);
    const instances = generation.json().items as Array<{
      id: string;
      version: number;
      plannedDate: string;
    }>;
    const augustInstances = instances.filter((task) => task.plannedDate.startsWith('2026-08'));
    expect(augustInstances).toHaveLength(5);

    harness.now.setTime(new Date('2026-08-25T09:00:00+08:00').getTime());
    await completeTask(harness, augustInstances[0]!);
    await completeTask(harness, augustInstances[1]!);
    harness.now.setTime(new Date('2026-09-08T09:00:00+08:00').getTime());
    await completeTask(harness, instances.find((task) => task.plannedDate === '2026-09-07')!);

    harness.now.setTime(new Date('2026-08-01T09:00:00+08:00').getTime());
    const carryTasks = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        createTask(harness.app, { title: `Carry ${index + 1}`, plannedDate: '2026-08-01' }),
      ),
    );
    for (let step = 1; step <= 6; step += 1) {
      const date = `2026-08-${String(step + 1).padStart(2, '0')}`;
      harness.now.setTime(new Date(`${date}T09:00:00+08:00`).getTime());
      const response = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/days/${date}/carryover`,
        payload: {
          decisions: carryTasks
            .filter((_, index) => index + 1 >= step)
            .map((task) => ({ taskId: task.id, action: 'carry_today' })),
        },
      });
      expect(response.statusCode).toBe(200);
    }

    harness.now.setTime(new Date('2026-08-31T09:00:00+08:00').getTime());
    const monthly = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/reviews/monthly',
      payload: { date: '2026-08-31' },
    });
    expect(monthly.statusCode).toBe(200);
    expect(monthly.json().content.repeatCompletionRate).toBe(40);
    expect(monthly.json().content.frequentCarryovers).toEqual(
      [6, 5, 4, 3, 2].map((count) => ({
        taskId: carryTasks[count - 1]!.id,
        title: `Carry ${count}`,
        count,
      })),
    );
  });

  it('shows only active goals with monthly completions and cumulative progress', async () => {
    const createGoal = async (title: string, status = 'active') => {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/goals',
        payload: { title, status },
      });
      expect(response.statusCode).toBe(201);
      return response.json();
    };
    const firstGoal = await createGoal('Product');
    const secondGoal = await createGoal('Health');
    const hiddenGoal = await createGoal('Finished goal', 'completed');

    harness.now.setTime(new Date('2026-07-31T09:00:00+08:00').getTime());
    await completeTask(harness, await createTask(harness.app, { title: 'July result', goalId: firstGoal.id }));
    harness.now.setTime(new Date('2026-08-21T09:00:00+08:00').getTime());
    await completeTask(harness, await createTask(harness.app, { title: 'August result', goalId: firstGoal.id }));
    await createTask(harness.app, { title: 'Keep training', goalId: secondGoal.id });

    const monthly = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/reviews/monthly',
      payload: { date: '2026-08-21' },
    });
    expect(monthly.statusCode).toBe(200);
    expect(monthly.json().content.goals).toEqual(expect.arrayContaining([
      expect.objectContaining({ goalId: firstGoal.id, title: 'Product', monthCompleted: 1, completed: 2, total: 2, percent: 100 }),
      expect.objectContaining({ goalId: secondGoal.id, title: 'Health', monthCompleted: 0, completed: 0, total: 1, percent: 0 }),
    ]));
    expect(monthly.json().content.goals.some((item: { goalId: string }) => item.goalId === hiddenGoal.id)).toBe(false);
  });
});

async function patchTask(
  harness: TestHarness,
  id: string,
  version: number,
  patch: Record<string, unknown>,
) {
  const response = await harness.app.inject({
    method: 'PATCH',
    url: `/api/v1/tasks/${id}`,
    payload: { version, patch },
  });
  expect(response.statusCode).toBe(200);
  return response.json();
}

function addDependency(harness: TestHarness, successorId: string, predecessorId: string) {
  return harness.app.inject({
    method: 'POST',
    url: `/api/v1/tasks/${successorId}/dependencies`,
    payload: { predecessorId },
  });
}

async function completeTask(harness: TestHarness, task: { id: string; version: number }) {
  const started = await patchTask(harness, task.id, task.version, { status: 'in_progress' });
  return patchTask(harness, task.id, started.version, { status: 'completed' });
}

function temperaturePoint(
  periodStart: string,
  periodEnd: string,
  temperature: 'inspiration' | 'cold' | 'warm' | 'hot',
) {
  const byTemperature = { inspiration: 0, cold: 0, warm: 0, hot: 0 };
  byTemperature[temperature] = 1;
  return { periodStart, periodEnd, byTemperature };
}
