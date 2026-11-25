import { DomainError } from './DomainErrors';

export class InvalidRecurrenceScheduleError extends DomainError {
  constructor(message = 'Invalid recurring schedule configuration.') {
    super(message, 'INVALID_RECURRENCE_SCHEDULE');
  }
}

export class InvalidRecurringDateError extends DomainError {
  constructor(message = 'Recurring schedule date must be a valid local calendar date formatted as YYYY-MM-DD.') {
    super(message, 'INVALID_RECURRING_DATE');
  }
}

export class RecurringRuleNotFoundError extends DomainError {
  constructor(identifier?: string) {
    super(
      identifier
        ? `Recurring schedule with ID '${identifier}' was not found.`
        : 'The specified recurring schedule was not found.',
      'RECURRING_RULE_NOT_FOUND'
    );
  }
}

export class RecurringOccurrenceNotFoundError extends DomainError {
  constructor(identifier?: string) {
    super(
      identifier
        ? `Recurring reminder occurrence with ID '${identifier}' was not found.`
        : 'The specified recurring reminder occurrence was not found.',
      'RECURRING_OCCURRENCE_NOT_FOUND'
    );
  }
}

export class DuplicateRecurringOccurrenceError extends DomainError {
  constructor(ruleId: string, occurrenceDate: string) {
    super(
      `An occurrence for recurring schedule '${ruleId}' on '${occurrenceDate}' already exists.`,
      'DUPLICATE_RECURRING_OCCURRENCE'
    );
  }
}

export class RecurringOccurrenceAlreadyResolvedError extends DomainError {
  constructor(status: string) {
    super(
      `This recurring payment reminder has already been marked as '${status}'.`,
      'RECURRING_OCCURRENCE_ALREADY_RESOLVED'
    );
  }
}

export class RecurringRuleNotActiveError extends DomainError {
  constructor(status: string) {
    super(
      `Cannot perform this action because recurring schedule status is '${status}'.`,
      'RECURRING_RULE_NOT_ACTIVE'
    );
  }
}
