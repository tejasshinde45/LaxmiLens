import { type QueryClient } from '@tanstack/react-query';
import {
  EvaluateFinancialAlertsResultDTO,
  EvaluateFinancialAlertsUseCase,
  GetBudgetsOverviewUseCase,
  GetRecurringOverviewUseCase
} from '@/application';
import { validateUserId } from '@/domain/value-objects/Identifiers';
import { queryClient as globalQueryClient } from '@/lib/queryClient';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import {
  NoActiveDatabaseSessionError,
  UnauthorizedDatabaseAccessError
} from '@/infrastructure/database/local/errors/DatabaseErrors';
import { DexieNotificationRepository } from '@/infrastructure/database/local/repositories/DexieNotificationRepository';
import { DexieNotificationPreferenceRepository } from '@/infrastructure/database/local/repositories/DexieNotificationPreferenceRepository';
import { DexieBudgetRepository } from '@/infrastructure/database/local/repositories/DexieBudgetRepository';
import { DexieTransactionRepository } from '@/infrastructure/database/local/repositories/DexieTransactionRepository';
import { DexieCategoryRepository } from '@/infrastructure/database/local/repositories/DexieCategoryRepository';
import { DexieRecurringRuleRepository } from '@/infrastructure/database/local/repositories/DexieRecurringRuleRepository';
import { DexieRecurringOccurrenceRepository } from '@/infrastructure/database/local/repositories/DexieRecurringOccurrenceRepository';
import { DexieAccountRepository } from '@/infrastructure/database/local/repositories/DexieAccountRepository';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { DexieUnitOfWork } from '@/infrastructure/database/local/DexieUnitOfWork';
import { db } from '@/infrastructure/database/local/DexieDatabase';
import { notificationQueryKeys } from '../hooks/notificationQueryKeys';

let fallbackEvaluateUseCase: EvaluateFinancialAlertsUseCase | null = null;

function getFallbackEvaluateUseCase(): EvaluateFinancialAlertsUseCase {
  if (!fallbackEvaluateUseCase) {
    const notificationRepo = new DexieNotificationRepository(db);
    const preferenceRepo = new DexieNotificationPreferenceRepository(db);
    const budgetRepo = new DexieBudgetRepository(db);
    const txRepo = new DexieTransactionRepository(db);
    const categoryRepo = new DexieCategoryRepository(db);
    const ruleRepo = new DexieRecurringRuleRepository(db);
    const occRepo = new DexieRecurringOccurrenceRepository(db);
    const accountRepo = new DexieAccountRepository(db);
    const outbox = new OutboxManager(db);
    const uow = new DexieUnitOfWork(db);

    fallbackEvaluateUseCase = new EvaluateFinancialAlertsUseCase(
      notificationRepo,
      preferenceRepo,
      new GetBudgetsOverviewUseCase(budgetRepo, txRepo, categoryRepo),
      new GetRecurringOverviewUseCase(ruleRepo, occRepo, accountRepo, categoryRepo),
      outbox,
      uow
    );
  }
  return fallbackEvaluateUseCase;
}

const initialEvaluatedUsers = new Set<string>();
const inFlightByUser = new Map<string, Promise<EvaluateFinancialAlertsResultDTO | null>>();

export function resetNotificationEvaluationState(userId?: string): void {
  if (userId) {
    initialEvaluatedUsers.delete(userId);
    return;
  }
  initialEvaluatedUsers.clear();
}

async function resolveEvaluateUseCase(
  targetUserId: string
): Promise<EvaluateFinancialAlertsUseCase | null> {
  try {
    const activeUserId = defaultDatabaseManager.getActiveUserId();
    if (activeUserId && activeUserId !== targetUserId) {
      return null;
    }
    const repos = await defaultDatabaseManager.getActiveRepositories();
    if (defaultDatabaseManager.getActiveUserId() && defaultDatabaseManager.getActiveUserId() !== targetUserId) {
      return null;
    }
    return repos.evaluateFinancialAlertsUseCase;
  } catch (error) {
    if (error instanceof UnauthorizedDatabaseAccessError) {
      return null;
    }
    if (error instanceof NoActiveDatabaseSessionError) {
      if (typeof globalThis.indexedDB === 'undefined') {
        return null;
      }
      return getFallbackEvaluateUseCase();
    }
    throw error;
  }
}

export async function evaluateAlertsNow(
  rawUserId: string,
  client: QueryClient = globalQueryClient
): Promise<EvaluateFinancialAlertsResultDTO | null> {
  if (!rawUserId) {
    return null;
  }

  let validatedUserId: string;
  try {
    validatedUserId = validateUserId(rawUserId);
  } catch {
    return null;
  }

  const priorInFlight = inFlightByUser.get(validatedUserId);
  const run = (priorInFlight ? priorInFlight.catch(() => null) : Promise.resolve(null)).then(
    async (): Promise<EvaluateFinancialAlertsResultDTO | null> => {
      const useCase = await resolveEvaluateUseCase(validatedUserId);
      if (!useCase) {
        return null;
      }

      const result = await useCase.execute(validatedUserId);
      if (result.createdCount > 0 || result.updatedCount > 0) {
        await Promise.all([
          client.invalidateQueries({ queryKey: notificationQueryKeys.all(validatedUserId) }),
          client.invalidateQueries({ queryKey: notificationQueryKeys.pendingOutbox(validatedUserId) }),
          client.invalidateQueries({ queryKey: ['syncPendingCount', validatedUserId] })
        ]);
      }
      return result;
    }
  );

  inFlightByUser.set(validatedUserId, run);
  try {
    return await run;
  } finally {
    if (inFlightByUser.get(validatedUserId) === run) {
      inFlightByUser.delete(validatedUserId);
    }
  }
}

export function triggerAlertEvaluationSafely(
  rawUserId: string,
  client: QueryClient = globalQueryClient
): void {
  void evaluateAlertsNow(rawUserId, client).catch(() => null);
}

export async function runInitialSessionEvaluation(
  rawUserId: string,
  client: QueryClient = globalQueryClient
): Promise<EvaluateFinancialAlertsResultDTO | null> {
  if (!rawUserId) {
    return null;
  }

  let validatedUserId: string;
  try {
    validatedUserId = validateUserId(rawUserId);
  } catch {
    return null;
  }

  if (initialEvaluatedUsers.has(validatedUserId)) {
    return null;
  }

  initialEvaluatedUsers.add(validatedUserId);
  try {
    return await evaluateAlertsNow(validatedUserId, client);
  } catch (error) {
    // Allow recovery on a future session trigger if the initial attempt failed unexpectedly
    initialEvaluatedUsers.delete(validatedUserId);
    throw error;
  }
}
