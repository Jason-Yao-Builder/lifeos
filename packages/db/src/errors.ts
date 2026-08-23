export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND';

  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

export class VersionConflictError extends Error {
  readonly code = 'VERSION_CONFLICT';

  constructor(resource: string, id: string) {
    super(`${resource} version conflict: ${id}`);
    this.name = 'VersionConflictError';
  }
}

export class InvalidMutationError extends Error {
  readonly code = 'INVALID_MUTATION';

  constructor(message: string) {
    super(message);
    this.name = 'InvalidMutationError';
  }
}
