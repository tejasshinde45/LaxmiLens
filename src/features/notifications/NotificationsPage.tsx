import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  BellOff,
  CheckCheck,
  Check,
  X,
  Repeat,
  AlertTriangle,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  CloudUpload
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge, type BadgeProps } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { NotificationDTO } from '@/application';
import {
  NotificationCategory,
  NotificationSeverity
} from '@/domain/services/NotificationIdentityService';
import { cn } from '@/utils/cn';
import { useAccountSync } from '@/features/accounts/hooks/useAccountSync';
import { useNotifications } from './hooks/useNotifications';

type StatusTab = 'all' | 'unread' | 'history';
type CategoryFilter = 'all' | NotificationCategory;

function isSafeInternalRoute(route: string): boolean {
  const trimmed = route.trim();
  return (
    trimmed.startsWith('/') &&
    !trimmed.startsWith('//') &&
    !trimmed.includes('://') &&
    !trimmed.includes('\\') &&
    !trimmed.includes(':') &&
    !trimmed.includes('..')
  );
}

function getCategoryLabel(category: NotificationCategory): string {
  switch (category) {
    case 'recurring_payment':
      return 'Recurring Payment';
    case 'budget_warning':
      return 'Budget Warning';
    case 'budget_exceeded':
      return 'Budget Exceeded';
  }
}

function getSeverityMeta(severity: NotificationSeverity): {
  label: string;
  variant: NonNullable<BadgeProps['variant']>;
} {
  switch (severity) {
    case 'info':
      return { label: 'Info', variant: 'transfer' };
    case 'warning':
      return { label: 'Warning', variant: 'warning' };
    case 'critical':
      return { label: 'Critical', variant: 'expense' };
  }
}

function formatCalendarDateDisplay(dateStr: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return dateStr;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function formatTimestampShort(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function getActionLabel(notification: NotificationDTO): string {
  if (notification.actionRoute.startsWith('/budgets')) {
    return 'Open Budgets';
  }
  if (notification.actionRoute.startsWith('/recurring')) {
    return 'Open Recurring';
  }
  return 'View Details';
}

export const NotificationsPage: React.FC = () => {
  const navigate = useNavigate();
  const [statusTab, setStatusTab] = useState<StatusTab>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');

  const {
    allNotifications,
    unreadCount,
    pendingNotificationIdSet,
    isLoading,
    isError,
    error,
    refetch,
    markAsRead,
    isMarkingRead,
    markAllAsRead,
    isMarkingAllRead,
    dismissNotification,
    isDismissing
  } = useNotifications();

  const { syncNow, isSyncing, pendingCount, isAuthenticated } = useAccountSync();

  const activeNotificationsCount = useMemo(
    () => allNotifications.filter((n) => n.status !== 'dismissed').length,
    [allNotifications]
  );

  const historyNotificationsCount = useMemo(
    () => allNotifications.filter((n) => n.status === 'read' || n.status === 'dismissed').length,
    [allNotifications]
  );

  const visibleNotifications = useMemo(() => {
    return allNotifications.filter((item) => {
      if (statusTab === 'all' && item.status === 'dismissed') {
        return false;
      }
      if (statusTab === 'unread' && item.status !== 'unread') {
        return false;
      }
      if (statusTab === 'history' && item.status === 'unread') {
        return false;
      }
      if (categoryFilter !== 'all' && item.category !== categoryFilter) {
        return false;
      }
      return true;
    });
  }, [allNotifications, statusTab, categoryFilter]);

  const handleOpenRoute = (route: string) => {
    if (!isSafeInternalRoute(route)) {
      return;
    }
    navigate(route);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Monitor upcoming and overdue recurring payments, budget thresholds, and your alert history."
        badge={
          <Badge variant={unreadCount > 0 ? 'gold' : 'neutral'} size="sm" dot={unreadCount > 0}>
            {unreadCount} Unread
          </Badge>
        }
        actions={
          <div className="flex items-center gap-2.5 flex-wrap">
            <Button
              type="button"
              variant="outline"
              size="sm"
              leftIcon={<CheckCheck className="h-4 w-4" />}
              disabled={unreadCount === 0 || isMarkingAllRead}
              isLoading={isMarkingAllRead}
              onClick={() => void markAllAsRead()}
            >
              Mark All as Read
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={<CloudUpload className="h-4 w-4 text-[#D6AD60]" />}
              disabled={!isAuthenticated || isSyncing}
              isLoading={isSyncing}
              onClick={() => void syncNow()}
            >
              <span>Sync Cloud</span>
              {pendingCount > 0 && (
                <Badge variant="gold" size="sm" className="ml-1">
                  {pendingCount}
                </Badge>
              )}
            </Button>
          </div>
        }
      />

      {/* Filter Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* All / Unread / History Filter Tabs */}
        <div
          role="tablist"
          aria-label="Notification status filter"
          className="inline-flex rounded-[10px] border border-[#303030] bg-[#1B1B1B] p-1 gap-1 self-start"
        >
          <button
            type="button"
            role="tab"
            aria-selected={statusTab === 'all'}
            onClick={() => setStatusTab('all')}
            className={cn(
              'rounded-[7px] px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60]',
              statusTab === 'all'
                ? 'bg-[#D6AD60]/15 text-[#D6AD60] font-semibold'
                : 'text-[#B9B4AA] hover:text-[#F5F1E8]'
            )}
          >
            All ({activeNotificationsCount})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={statusTab === 'unread'}
            onClick={() => setStatusTab('unread')}
            className={cn(
              'rounded-[7px] px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60]',
              statusTab === 'unread'
                ? 'bg-[#D6AD60]/15 text-[#D6AD60] font-semibold'
                : 'text-[#B9B4AA] hover:text-[#F5F1E8]'
            )}
          >
            Unread ({unreadCount})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={statusTab === 'history'}
            onClick={() => setStatusTab('history')}
            className={cn(
              'rounded-[7px] px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60]',
              statusTab === 'history'
                ? 'bg-[#D6AD60]/15 text-[#D6AD60] font-semibold'
                : 'text-[#B9B4AA] hover:text-[#F5F1E8]'
            )}
          >
            History ({historyNotificationsCount})
          </button>
        </div>

        {/* Category Filter Pills */}
        <div
          role="group"
          aria-label="Notification category filter"
          className="flex items-center gap-1.5 flex-wrap"
        >
          {(
            [
              { value: 'all', label: 'All Categories' },
              { value: 'recurring_payment', label: 'Recurring Payment' },
              { value: 'budget_warning', label: 'Budget Warning' },
              { value: 'budget_exceeded', label: 'Budget Exceeded' }
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={categoryFilter === option.value}
              onClick={() => setCategoryFilter(option.value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60]',
                categoryFilter === option.value
                  ? 'border-[#D6AD60]/50 bg-[#D6AD60]/15 text-[#D6AD60]'
                  : 'border-[#303030] bg-[#1B1B1B] text-[#B9B4AA] hover:border-[#454545] hover:text-[#F5F1E8]'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Notification List */}
      {isLoading ? (
        <div className="space-y-3" aria-label="Loading notifications">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      ) : isError ? (
        <Card variant="surface" className="p-6 text-center space-y-3 border-[#D9827C]/30">
          <AlertCircle className="h-8 w-8 text-[#D9827C] mx-auto" />
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-[#F5F1E8]">
              Unable to load notifications
            </h2>
            <p className="text-xs text-[#858078]">
              {error?.message || 'An unexpected error occurred while reading local alerts.'}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={() => void refetch()}
          >
            Try Again
          </Button>
        </Card>
      ) : visibleNotifications.length === 0 ? (
        <Card variant="surface" className="p-10 text-center space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#242424] text-[#D6AD60]">
            {statusTab === 'unread' ? (
              <BellOff className="h-5 w-5" />
            ) : (
              <Bell className="h-5 w-5" />
            )}
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-[#F5F1E8] font-display">
              {statusTab === 'unread'
                ? 'No unread notifications'
                : statusTab === 'history'
                ? 'No notification history yet'
                : 'No notifications to show'}
            </h2>
            <p className="text-xs text-[#858078] max-w-md mx-auto leading-relaxed">
              {statusTab === 'unread'
                ? 'You are completely caught up on recurring payment reminders and budget alerts.'
                : 'Financial alerts will appear here automatically when recurring bills are due or budgets reach warning thresholds.'}
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 pt-2 flex-wrap">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigate('/settings')}
            >
              Alert Preferences
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-3" role="list" aria-label="Notification items">
          {visibleNotifications.map((item) => {
            const severityMeta = getSeverityMeta(item.severity);
            const isUnread = item.status === 'unread';
            const isPendingSync = pendingNotificationIdSet.has(item.id);
            const CategoryIcon =
              item.category === 'recurring_payment'
                ? Repeat
                : item.category === 'budget_exceeded'
                ? AlertCircle
                : AlertTriangle;

            return (
              <Card
                key={item.id}
                role="listitem"
                variant="surface"
                data-status={item.status}
                className={cn(
                  'p-4 sm:p-5 transition-colors',
                  isUnread
                    ? 'border-[#D6AD60]/45 bg-[#D6AD60]/[0.04]'
                    : 'border-[#303030] bg-[#1B1B1B] opacity-90'
                )}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      aria-hidden="true"
                      className={cn(
                        'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border',
                        item.severity === 'critical'
                          ? 'border-[#D9827C]/30 bg-[#D9827C]/15 text-[#D9827C]'
                          : item.severity === 'warning'
                          ? 'border-[#E4B66D]/30 bg-[#E4B66D]/15 text-[#E4B66D]'
                          : 'border-[#82A9CF]/30 bg-[#82A9CF]/15 text-[#82A9CF]'
                      )}
                    >
                      <CategoryIcon className="h-4 w-4" aria-hidden="true" />
                    </div>

                    <div className="min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        {isUnread && (
                          <span
                            className="h-2 w-2 rounded-full bg-[#D6AD60] shrink-0"
                            aria-hidden="true"
                          />
                        )}
                        <h3
                          className={cn(
                            'text-sm leading-snug text-[#F5F1E8]',
                            isUnread ? 'font-bold' : 'font-medium text-[#B9B4AA]'
                          )}
                        >
                          {item.title}
                        </h3>
                      </div>

                      <p className="text-xs text-[#B9B4AA] leading-relaxed">{item.message}</p>

                      <div className="flex items-center gap-2 pt-1 flex-wrap text-[11px]">
                        <Badge variant="neutral" size="sm">
                          {getCategoryLabel(item.category)}
                        </Badge>
                        <Badge variant={severityMeta.variant} size="sm">
                          {severityMeta.label}
                        </Badge>
                        {item.status === 'unread' ? (
                          <Badge variant="gold" size="sm">
                            Unread
                          </Badge>
                        ) : item.status === 'read' ? (
                          <Badge variant="outline" size="sm">
                            Read {formatTimestampShort(item.readAt)}
                          </Badge>
                        ) : (
                          <Badge variant="outline" size="sm">
                            Dismissed {formatTimestampShort(item.dismissedAt)}
                          </Badge>
                        )}
                        {isPendingSync && (
                          <Badge variant="outline" size="sm">
                            Pending Sync
                          </Badge>
                        )}
                        <span className="text-[#858078]">
                          Date: {formatCalendarDateDisplay(item.triggerDate)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Row Actions */}
                  <div className="flex items-center gap-2 shrink-0 pt-1 sm:pt-0 flex-wrap">
                    {isSafeInternalRoute(item.actionRoute) && (
                      <Button
                        type="button"
                        variant="gold-subtle"
                        size="sm"
                        rightIcon={<ExternalLink className="h-3.5 w-3.5" />}
                        onClick={() => handleOpenRoute(item.actionRoute)}
                      >
                        {getActionLabel(item)}
                      </Button>
                    )}

                    {isUnread && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        leftIcon={<Check className="h-3.5 w-3.5" />}
                        disabled={isMarkingRead}
                        onClick={() => void markAsRead(item.id)}
                      >
                        Mark as Read
                      </Button>
                    )}

                    {item.status !== 'dismissed' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        leftIcon={<X className="h-3.5 w-3.5" />}
                        disabled={isDismissing}
                        onClick={() => void dismissNotification(item.id)}
                      >
                        Dismiss
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
