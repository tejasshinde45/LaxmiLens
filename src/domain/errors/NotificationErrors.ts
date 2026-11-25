import { DomainError } from './DomainErrors';

export class InvalidNotificationError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_NOTIFICATION');
  }
}

export class InvalidNotificationPreferenceError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_NOTIFICATION_PREFERENCE');
  }
}

export class NotificationNotFoundError extends DomainError {
  constructor(notificationId: string) {
    super(`Notification ${notificationId} not found`, 'NOTIFICATION_NOT_FOUND');
  }
}

export class DuplicateNotificationError extends DomainError {
  constructor(dedupeKey: string) {
    super(`Notification already exists for dedupe key "${dedupeKey}"`, 'DUPLICATE_NOTIFICATION');
  }
}

export class NotificationAlreadyDismissedError extends DomainError {
  constructor(notificationId: string) {
    super(`Notification ${notificationId} is already dismissed`, 'NOTIFICATION_ALREADY_DISMISSED');
  }
}
