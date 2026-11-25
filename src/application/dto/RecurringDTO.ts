import { RecurrenceFrequency, RecurringRuleStatus, RecurringTransactionType } from '@/domain/entities/RecurringRule';
import { RecurringOccurrenceStatus } from '@/domain/entities/RecurringOccurrence';

export interface CreateRecurringRuleDTO {
  userId: string;
  title: string;
  description?: string;
  type: RecurringTransactionType;
  amountPaise: number;
  accountId: string;
  categoryId?: string;
  frequency: RecurrenceFrequency;
  interval?: number;
  startDate: string; // YYYY-MM-DD
  endDate?: string | null; // YYYY-MM-DD
}

export interface UpdateRecurringRuleDTO {
  id: string;
  userId: string;
  title?: string;
  description?: string | null;
  amountPaise?: number;
  accountId?: string;
  categoryId?: string | null;
  frequency?: RecurrenceFrequency;
  interval?: number;
  endDate?: string | null;
  nextDueDate?: string;
}

export interface PauseResumeRecurringRuleDTO {
  id: string;
  userId: string;
}

export interface DeleteRecurringRuleDTO {
  id: string;
  userId: string;
}

export interface ConfirmRecurringOccurrenceDTO {
  userId: string;
  recurringRuleId: string;
  occurrenceDate: string; // YYYY-MM-DD
  occurrenceId?: string;
  overrideTitle?: string;
  overrideNote?: string;
}

export interface SkipRecurringOccurrenceDTO {
  userId: string;
  recurringRuleId: string;
  occurrenceDate: string; // YYYY-MM-DD
  occurrenceId?: string;
}

export interface SnoozeRecurringOccurrenceDTO {
  userId: string;
  recurringRuleId: string;
  occurrenceDate: string; // YYYY-MM-DD
  snoozeUntilDate: string; // YYYY-MM-DD
  occurrenceId?: string;
}

export interface DismissRecurringOccurrenceDTO {
  userId: string;
  recurringRuleId: string;
  occurrenceDate: string; // YYYY-MM-DD
  occurrenceId?: string;
}

export interface RecurringRuleResponseDTO {
  id: string;
  userId: string;
  title: string;
  description?: string;
  type: RecurringTransactionType;
  amountPaise: number;
  amountFormatted: string;
  accountId: string;
  accountName: string;
  categoryId?: string;
  categoryName?: string;
  categoryIcon?: string;
  categoryColor?: string;
  frequency: RecurrenceFrequency;
  interval: number;
  anchorDayOfMonth: number;
  startDate: string;
  endDate: string | null;
  nextDueDate: string;
  lastGeneratedDate: string | null;
  status: RecurringRuleStatus;
  requiresUserConfirmation: boolean;
  previewDates: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type ReminderBucket = 'overdue' | 'dueToday' | 'upcoming' | 'snoozed';

export interface RecurringReminderDTO {
  occurrenceId?: string;
  recurringRuleId: string;
  userId: string;
  title: string;
  description?: string;
  type: RecurringTransactionType;
  amountPaise: number;
  amountFormatted: string;
  accountId: string;
  accountName: string;
  categoryId?: string;
  categoryName?: string;
  categoryIcon?: string;
  categoryColor?: string;
  frequency: RecurrenceFrequency;
  interval: number;
  occurrenceDate: string; // Scheduled YYYY-MM-DD
  effectiveDueDate: string; // snoozedUntilDate ?? occurrenceDate
  snoozedUntilDate: string | null;
  status: RecurringOccurrenceStatus;
  bucket: ReminderBucket;
  daysUntilDue: number; // Negative when overdue
  transactionId?: string | null;
  confirmedAt?: string | null;
  idempotencyKey: string;
}

export interface ConfirmRecurringOccurrenceResultDTO {
  occurrenceId: string;
  recurringRuleId: string;
  occurrenceDate: string;
  transactionId: string;
  alreadyConfirmed: boolean;
  nextDueDate: string;
  ruleStatus: RecurringRuleStatus;
}

export interface RecurringOverviewSummaryDTO {
  asOfDate: string;
  activeSchedulesCount: number;
  pausedSchedulesCount: number;
  completedSchedulesCount: number;
  overdueCount: number;
  dueTodayCount: number;
  upcomingCount: number;
  snoozedCount: number;
  totalOverdueAmountPaise: number;
  totalOverdueAmountFormatted: string;
  totalDueTodayAmountPaise: number;
  totalDueTodayAmountFormatted: string;
  totalUpcoming30DaysExpensePaise: number;
  totalUpcoming30DaysExpenseFormatted: string;
  totalUpcoming30DaysIncomePaise: number;
  totalUpcoming30DaysIncomeFormatted: string;
}

export interface RecurringOverviewResponseDTO {
  summary: RecurringOverviewSummaryDTO;
  overdue: RecurringReminderDTO[];
  dueToday: RecurringReminderDTO[];
  upcoming: RecurringReminderDTO[];
  snoozed: RecurringReminderDTO[];
  recentlyGenerated: RecurringReminderDTO[];
  schedules: RecurringRuleResponseDTO[];
}
