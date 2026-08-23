export interface DomainIssue {
  path: string;
  message: string;
  code: string;
}

export class DomainValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';

  constructor(
    message: string,
    readonly issues: readonly DomainIssue[],
  ) {
    super(message);
    this.name = 'DomainValidationError';
  }
}

export class InvalidTransitionError extends Error {
  readonly code = 'INVALID_TRANSITION';

  constructor(
    readonly entity: 'task' | 'card',
    readonly from: string,
    readonly to: string,
  ) {
    super(`Cannot transition ${entity} from ${from} to ${to}`);
    this.name = 'InvalidTransitionError';
  }
}
