import { InvalidNotificationPreferenceError } from '../errors/NotificationErrors';
import { UserId, validateUserId } from '../value-objects/Identifiers';

export const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  recurringPaymentEnabled: true,
  budgetWarningEnabled: true,
  budgetExceededEnabled: true,
  upcomingLeadDays: 3
});

export const MIN_UPCOMING_LEAD_DAYS = 0;
export const MAX_UPCOMING_LEAD_DAYS = 30;

export interface NotificationPreferenceProps {
  userId: UserId | string;
  recurringPaymentEnabled: boolean;
  budgetWarningEnabled: boolean;
  budgetExceededEnabled: boolean;
  upcomingLeadDays: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateNotificationPreferencePatch {
  recurringPaymentEnabled?: boolean;
  budgetWarningEnabled?: boolean;
  budgetExceededEnabled?: boolean;
  upcomingLeadDays?: number;
}

export class NotificationPreference {
  public readonly userId: UserId;
  public readonly recurringPaymentEnabled: boolean;
  public readonly budgetWarningEnabled: boolean;
  public readonly budgetExceededEnabled: boolean;
  public readonly upcomingLeadDays: number;
  public readonly version: number;
  public readonly createdAt: string;
  public readonly updatedAt: string;

  constructor(props: NotificationPreferenceProps) {
    this.userId = validateUserId(props.userId);

    if (
      typeof props.recurringPaymentEnabled !== 'boolean' ||
      typeof props.budgetWarningEnabled !== 'boolean' ||
      typeof props.budgetExceededEnabled !== 'boolean'
    ) {
      throw new InvalidNotificationPreferenceError(
        'Notification preference toggles must be boolean values'
      );
    }

    if (
      typeof props.upcomingLeadDays !== 'number' ||
      !Number.isSafeInteger(props.upcomingLeadDays) ||
      props.upcomingLeadDays < MIN_UPCOMING_LEAD_DAYS ||
      props.upcomingLeadDays > MAX_UPCOMING_LEAD_DAYS
    ) {
      throw new InvalidNotificationPreferenceError(
        `upcomingLeadDays must be an integer between ${MIN_UPCOMING_LEAD_DAYS} and ${MAX_UPCOMING_LEAD_DAYS}`
      );
    }

    if (!Number.isSafeInteger(props.version) || props.version < 1) {
      throw new InvalidNotificationPreferenceError(
        'NotificationPreference version must be an integer >= 1'
      );
    }

    if (!props.createdAt || !props.updatedAt) {
      throw new InvalidNotificationPreferenceError(
        'NotificationPreference createdAt and updatedAt timestamps are required'
      );
    }

    this.recurringPaymentEnabled = props.recurringPaymentEnabled;
    this.budgetWarningEnabled = props.budgetWarningEnabled;
    this.budgetExceededEnabled = props.budgetExceededEnabled;
    this.upcomingLeadDays = props.upcomingLeadDays;
    this.version = props.version;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;

    Object.freeze(this);
  }

  public static createDefault(
    userId: UserId | string,
    now = new Date().toISOString()
  ): NotificationPreference {
    return new NotificationPreference({
      userId,
      recurringPaymentEnabled: DEFAULT_NOTIFICATION_PREFERENCES.recurringPaymentEnabled,
      budgetWarningEnabled: DEFAULT_NOTIFICATION_PREFERENCES.budgetWarningEnabled,
      budgetExceededEnabled: DEFAULT_NOTIFICATION_PREFERENCES.budgetExceededEnabled,
      upcomingLeadDays: DEFAULT_NOTIFICATION_PREFERENCES.upcomingLeadDays,
      version: 1,
      createdAt: now,
      updatedAt: now
    });
  }

  public update(
    patch: UpdateNotificationPreferencePatch,
    now = new Date().toISOString()
  ): NotificationPreference {
    const nextRecurring = patch.recurringPaymentEnabled ?? this.recurringPaymentEnabled;
    const nextBudgetWarning = patch.budgetWarningEnabled ?? this.budgetWarningEnabled;
    const nextBudgetExceeded = patch.budgetExceededEnabled ?? this.budgetExceededEnabled;
    const nextLeadDays = patch.upcomingLeadDays ?? this.upcomingLeadDays;

    if (
      nextRecurring === this.recurringPaymentEnabled &&
      nextBudgetWarning === this.budgetWarningEnabled &&
      nextBudgetExceeded === this.budgetExceededEnabled &&
      nextLeadDays === this.upcomingLeadDays
    ) {
      return this;
    }

    return new NotificationPreference({
      userId: this.userId,
      recurringPaymentEnabled: nextRecurring,
      budgetWarningEnabled: nextBudgetWarning,
      budgetExceededEnabled: nextBudgetExceeded,
      upcomingLeadDays: nextLeadDays,
      version: this.version + 1,
      createdAt: this.createdAt,
      updatedAt: now
    });
  }
}
