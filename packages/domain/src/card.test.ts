import type { Card } from '@lifeos/contracts';
import { describe, expect, it } from 'vitest';
import {
  InvalidTransitionError,
  canTransitionCardStatus,
  transitionCardStatus,
} from './index.js';

const card: Card = {
  id: 'card-1',
  tenantId: 'tenant-1',
  type: 'action',
  status: 'pending',
  title: 'Cool down task?',
  body: 'This task has stalled.',
  targetTaskId: 'task-1',
  hasDiscussion: false,
  createdAt: '2026-08-23T08:00:00+08:00',
  updatedAt: '2026-08-23T08:00:00+08:00',
  resolvedAt: null,
};

describe('card status transitions', () => {
  it('supports direct decisions and discussion branches', () => {
    expect(canTransitionCardStatus('pending', 'accepted')).toBe(true);
    expect(canTransitionCardStatus('pending', 'discussing')).toBe(true);
    expect(canTransitionCardStatus('discussing', 'resolved')).toBe(true);
    expect(canTransitionCardStatus('pending', 'resolved')).toBe(false);
  });

  it('marks a discussion without mutating the original card', () => {
    const discussing = transitionCardStatus(card, 'discussing', '2026-08-23T09:00:00+08:00');

    expect(discussing).toMatchObject({
      status: 'discussing',
      hasDiscussion: true,
      resolvedAt: null,
    });
    expect(card.status).toBe('pending');
  });

  it('records decision time and allows archival', () => {
    const accepted = transitionCardStatus(card, 'accepted', '2026-08-23T09:00:00+08:00');
    const archived = transitionCardStatus(accepted, 'archived', '2026-08-23T10:00:00+08:00');

    expect(accepted.resolvedAt).toBe('2026-08-23T09:00:00+08:00');
    expect(archived.status).toBe('archived');
    expect(archived.resolvedAt).toBe(accepted.resolvedAt);
  });

  it('rejects illegal and repeated transitions', () => {
    expect(() => transitionCardStatus(card, 'resolved', '2026-08-23T09:00:00+08:00')).toThrow(
      InvalidTransitionError,
    );
    expect(() => transitionCardStatus(card, 'pending', '2026-08-23T09:00:00+08:00')).toThrow(
      InvalidTransitionError,
    );
  });
});
