export abstract class SyncError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SyncAuthError extends SyncError {
  constructor(message: string) {
    super(message, 'SYNC_AUTH_ERROR');
  }
}

export class SyncConflictError extends SyncError {
  public readonly conflictingRecord?: unknown;

  constructor(message: string, conflictingRecord?: unknown) {
    super(message, 'SYNC_CONFLICT_ERROR');
    this.conflictingRecord = conflictingRecord;
  }
}

export class SyncDatabaseError extends SyncError {
  public readonly pgCode?: string;
  public readonly details?: string;
  public readonly hint?: string;

  constructor(message: string, pgCode?: string, originalError?: unknown) {
    super(message, 'SYNC_DATABASE_ERROR');
    this.pgCode = pgCode;

    if (originalError && typeof originalError === 'object') {
      const err = originalError as Record<string, unknown>;
      this.details = typeof err.details === 'string' ? err.details : undefined;
      this.hint = typeof err.hint === 'string' ? err.hint : undefined;
    }
  }

  public isRlsError(): boolean {
    return this.pgCode === '42501';
  }

  public isDuplicateKey(): boolean {
    return this.pgCode === '23505';
  }

  public isForeignKeyViolation(): boolean {
    return this.pgCode === '23503';
  }

  public isCheckViolation(): boolean {
    return this.pgCode === '23514';
  }
}

export class SyncInProgressError extends SyncError {
  constructor(message = 'Account synchronization is already in progress.') {
    super(message, 'SYNC_IN_PROGRESS');
  }
}

export class SyncUnresolvedCategoryError extends SyncError {
  public readonly categoryId: string;

  constructor(message: string, categoryId: string) {
    super(message, 'SYNC_UNRESOLVED_CATEGORY_ERROR');
    this.categoryId = categoryId;
  }
}

export class SyncAccountDependencyError extends SyncError {
  public readonly accountId: string;

  constructor(message: string, accountId: string) {
    super(message, 'SYNC_ACCOUNT_DEPENDENCY_ERROR');
    this.accountId = accountId;
  }
}


