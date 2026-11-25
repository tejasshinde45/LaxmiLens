import { InvalidNotificationError } from '../errors/NotificationErrors';
import { createNotificationId, isValidUuid, NotificationId, validateUserId } from '../value-objects/Identifiers';
import { BUDGET_PERIOD_REGEX } from '../entities/Budget';
import { isValidLocalCalendarDate } from './RecurrenceScheduleService';

export type NotificationCategory =
  | 'recurring_payment'
  | 'budget_warning'
  | 'budget_exceeded';

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export const NOTIFICATION_SEVERITY_RANK: Readonly<Record<NotificationSeverity, number>> =
  Object.freeze({
    info: 1,
    warning: 2,
    critical: 3
  });

export const NOTIFICATION_CATEGORY_RANK: Readonly<Record<NotificationCategory, number>> =
  Object.freeze({
    recurring_payment: 1,
    budget_warning: 1,
    budget_exceeded: 2
  });

export function compareNotificationSeverity(
  left: NotificationSeverity,
  right: NotificationSeverity
): number {
  return NOTIFICATION_SEVERITY_RANK[left] - NOTIFICATION_SEVERITY_RANK[right];
}

export function isCompatibleNotificationCategoryProgression(
  current: NotificationCategory,
  target: NotificationCategory
): boolean {
  if (current === target) {
    return true;
  }
  if (current === 'budget_warning' && target === 'budget_exceeded') {
    return true;
  }
  return false;
}

/**
 * Stable recurring notification identity per (userId, recurringRuleId, occurrenceDate).
 * Deliberately excludes urgency stage so upcoming, due-today, and overdue update one record.
 */
export function buildRecurringNotificationDedupeKey(
  recurringRuleId: string,
  occurrenceDate: string
): string {
  const normalizedRuleId = recurringRuleId.trim();
  if (!normalizedRuleId) {
    throw new InvalidNotificationError('Recurring rule ID is required for notification dedupe key');
  }
  if (!isValidLocalCalendarDate(occurrenceDate)) {
    throw new InvalidNotificationError(
      `Invalid recurring occurrence date "${occurrenceDate}" for notification dedupe key`
    );
  }
  return `recurring_payment:${normalizedRuleId}:${occurrenceDate}`;
}

/**
 * Stable budget notification identity per (userId, budgetId, period).
 * Allows controlled promotion from budget_warning to budget_exceeded on one record.
 */
export function buildBudgetNotificationDedupeKey(budgetId: string, period: string): string {
  const normalizedBudgetId = budgetId.trim();
  if (!normalizedBudgetId) {
    throw new InvalidNotificationError('Budget ID is required for notification dedupe key');
  }
  if (!BUDGET_PERIOD_REGEX.test(period)) {
    throw new InvalidNotificationError(
      `Invalid budget period "${period}" for notification dedupe key`
    );
  }
  return `budget_alert:${normalizedBudgetId}:${period}`;
}

function formatBytesAsUuid(bytes: Uint8Array): string {
  const hex: string[] = [];
  for (let i = 0; i < 16; i += 1) {
    hex.push(bytes[i]!.toString(16).padStart(2, '0'));
  }
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

/**
 * Derives a deterministic RFC 9562 version 8 custom UUID from (userId, dedupeKey) using
 * WebCrypto SHA-256. Produces identical UUIDs across modern browsers, Node/Vitest, and
 * Capacitor Android WebView without extra dependencies.
 */
export async function deriveDeterministicNotificationId(
  userId: string,
  dedupeKey: string
): Promise<NotificationId> {
  const validatedUserId = validateUserId(userId);
  const normalizedDedupeKey = dedupeKey.trim();
  if (!normalizedDedupeKey) {
    throw new InvalidNotificationError('Dedupe key must not be empty when deriving notification ID');
  }

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new InvalidNotificationError(
      'WebCrypto SHA-256 (crypto.subtle) is required for deterministic notification ID generation'
    );
  }

  const canonicalInput = `LaxmiLens:Notification:v1:${validatedUserId.toLowerCase()}:${normalizedDedupeKey}`;
  const encoded = new TextEncoder().encode(canonicalInput);
  const digestBuffer = await subtle.digest('SHA-256', encoded);
  const bytes = new Uint8Array(digestBuffer.slice(0, 16));

  // Set RFC 9562 version 8 (custom SHA-256 layout, 1000xxxx) and RFC variant bits (10xxxxxx).
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const uuid = formatBytesAsUuid(bytes);
  if (!isValidUuid(uuid)) {
    throw new InvalidNotificationError(`Derived invalid notification UUID: ${uuid}`);
  }
  return createNotificationId(uuid);
}
