import {
  NotificationEntityType,
  NotificationMetadata,
  NotificationStatus
} from '@/domain/entities/Notification';
import {
  NotificationCategory,
  NotificationSeverity
} from '@/domain/services/NotificationIdentityService';

export interface NotificationDTO {
  id: string;
  userId: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  status: NotificationStatus;
  dedupeKey: string;
  title: string;
  message: string;
  entityType: NotificationEntityType;
  entityId: string;
  triggerDate: string;
  actionRoute: string;
  metadata: NotificationMetadata;
  readAt?: string;
  dismissedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationsResponseDTO {
  notifications: NotificationDTO[];
  unreadCount: number;
  totalCount: number;
}

export interface GetNotificationsQueryDTO {
  status?: NotificationStatus;
  category?: NotificationCategory;
  severity?: NotificationSeverity;
}

export interface NotificationPreferenceDTO {
  userId: string;
  recurringPaymentEnabled: boolean;
  budgetWarningEnabled: boolean;
  budgetExceededEnabled: boolean;
  upcomingLeadDays: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  isDefault: boolean;
}

export interface UpdateNotificationPreferenceDTO {
  userId: string;
  recurringPaymentEnabled?: boolean;
  budgetWarningEnabled?: boolean;
  budgetExceededEnabled?: boolean;
  upcomingLeadDays?: number;
}

export interface EvaluateFinancialAlertsOptionsDTO {
  asOfDate?: string;
  period?: string;
}

export interface EvaluateFinancialAlertsResultDTO {
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  unreadCount: number;
  evaluatedAt: string;
}
