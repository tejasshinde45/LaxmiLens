export class DatabaseSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseSessionError';
  }
}

export class NoActiveDatabaseSessionError extends DatabaseSessionError {
  constructor(message = 'Cannot access database: No authenticated user session exists.') {
    super(message);
    this.name = 'NoActiveDatabaseSessionError';
  }
}

export class StaleSessionError extends DatabaseSessionError {
  constructor(message = 'Database operation aborted: The active user session has changed or signed out.') {
    super(message);
    this.name = 'StaleSessionError';
  }
}

export class InvalidDatabaseSessionError extends DatabaseSessionError {
  constructor(message = 'Invalid authenticated user ID for database session.') {
    super(message);
    this.name = 'InvalidDatabaseSessionError';
  }
}

export class UnauthorizedDatabaseAccessError extends DatabaseSessionError {
  constructor(userId: string, requestedUserId: string) {
    super(`Unauthorized database access: Authenticated session '${userId}' cannot access database for user '${requestedUserId}'.`);
    this.name = 'UnauthorizedDatabaseAccessError';
  }
}

export class MigrationConflictError extends Error {
  constructor(entity: string, entityId: string, message: string) {
    super(`Legacy migration halted for entity '${entity}' [ID: ${entityId}]: ${message}`);
    this.name = 'MigrationConflictError';
  }
}

export class DiagnosticIntegrityError extends Error {
  constructor(message: string) {
    super(`Diagnostic integrity failure: ${message}`);
    this.name = 'DiagnosticIntegrityError';
  }
}
