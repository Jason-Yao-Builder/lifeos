import type { Card, CardStatus } from '@lifeos/contracts';
import { InvalidTransitionError } from './errors.js';

export const CARD_STATUS_TRANSITIONS: Readonly<Record<CardStatus, readonly CardStatus[]>> = {
  pending: ['accepted', 'rejected', 'dismissed', 'discussing'],
  discussing: ['accepted', 'rejected', 'dismissed', 'resolved'],
  accepted: ['archived'],
  rejected: ['archived'],
  dismissed: ['archived'],
  resolved: ['archived'],
  archived: [],
};

export function canTransitionCardStatus(from: CardStatus, to: CardStatus): boolean {
  return CARD_STATUS_TRANSITIONS[from].includes(to);
}

export function transitionCardStatus<T extends Card>(card: T, to: CardStatus, at: string): T {
  if (!canTransitionCardStatus(card.status, to)) {
    throw new InvalidTransitionError('card', card.status, to);
  }

  const resolved = ['accepted', 'rejected', 'dismissed', 'resolved'].includes(to);
  return {
    ...card,
    status: to,
    hasDiscussion: card.hasDiscussion || to === 'discussing',
    resolvedAt: resolved ? at : card.resolvedAt,
    updatedAt: at,
  };
}
