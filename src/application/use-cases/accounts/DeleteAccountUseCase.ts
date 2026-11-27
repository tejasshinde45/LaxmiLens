import { AccountRepository } from '@/domain/repositories/AccountRepository';
import {
  AccountDeletionDependencies,
  AccountDeletionDependencyInspector
} from '@/application/ports/AccountDeletionPort';
import { SyncPort } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { createAccountId, validateUserId } from '@/domain/value-objects/Identifiers';
import {
  AccountDeletionBlockedError,
  AccountNotFoundError,
  UnauthorizedEntityAccessError
} from '@/domain/errors/DomainErrors';

export interface AccountDeletionEligibility {
  accountId: string;
  accountName: string;
  accountType: string;
  isArchived: boolean;
  canDelete: boolean;
  isSystemAccount: boolean;
  reasons: string[];
  dependencies: AccountDeletionDependencies;
}

function formatPlural(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export class DeleteAccountUseCase {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly dependencyInspector: AccountDeletionDependencyInspector,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  public async checkEligibility(
    accountIdStr: string,
    userIdStr: string
  ): Promise<AccountDeletionEligibility> {
    const accountId = createAccountId(accountIdStr);
    const validatedUserId = validateUserId(userIdStr);

    const existing = await this.accountRepo.findById(accountId, validatedUserId);
    if (!existing) {
      throw new AccountNotFoundError(accountIdStr);
    }

    if (existing.userId !== validatedUserId) {
      throw new UnauthorizedEntityAccessError('Account', accountIdStr);
    }

    const isSystemAccount =
      existing.isSystemAccount() ||
      existing.isPersonalBorrowingsLiability() ||
      existing.name.trim().toLowerCase() === 'personal borrowings';

    const dependencies = await this.dependencyInspector.inspect(accountId, validatedUserId);
    const reasons: string[] = [];

    if (isSystemAccount) {
      reasons.push(
        'System-managed accounts such as Personal Borrowings are required for ledger integrity and cannot be deleted.'
      );
    }

    if (dependencies.activeTransactionCount > 0) {
      reasons.push(
        `${formatPlural(dependencies.activeTransactionCount, 'active transaction')} reference this account.`
      );
    }

    if (dependencies.transferCount > 0) {
      reasons.push(
        `${formatPlural(dependencies.transferCount, 'account transfer')} reference this account as source or destination.`
      );
    }

    if (dependencies.softDeletedTransactionCount > 0) {
      reasons.push(
        `${formatPlural(dependencies.softDeletedTransactionCount, 'deleted transaction tombstone')} still reference this account for audit and sync history.`
      );
    }

    const totalRecurringRules =
      dependencies.activeRecurringRuleCount + dependencies.deletedRecurringRuleCount;
    if (totalRecurringRules > 0 || dependencies.recurringOccurrenceCount > 0) {
      if (totalRecurringRules > 0 && dependencies.recurringOccurrenceCount > 0) {
        reasons.push(
          `${formatPlural(totalRecurringRules, 'recurring rule')} and ${formatPlural(dependencies.recurringOccurrenceCount, 'scheduled occurrence')} reference this account.`
        );
      } else if (totalRecurringRules > 0) {
        reasons.push(
          `${formatPlural(totalRecurringRules, 'recurring rule')} reference this account.`
        );
      } else {
        reasons.push(
          `${formatPlural(dependencies.recurringOccurrenceCount, 'recurring occurrence')} reference this account.`
        );
      }
    }

    const totalBorrowingRecords = dependencies.borrowingCount + dependencies.repaymentCount;
    if (totalBorrowingRecords > 0) {
      reasons.push(
        `${formatPlural(totalBorrowingRecords, 'borrowing or repayment record')} reference this account.`
      );
    }

    const totalPendingOutbox =
      dependencies.pendingAccountOutboxCount + dependencies.pendingDependentOutboxCount;
    if (totalPendingOutbox > 0) {
      reasons.push(
        `${formatPlural(totalPendingOutbox, 'pending synchronization operation')} must finish syncing before this account can be permanently deleted.`
      );
    }

    return {
      accountId,
      accountName: existing.name,
      accountType: existing.accountType,
      isArchived: existing.isArchived,
      canDelete: reasons.length === 0,
      isSystemAccount,
      reasons,
      dependencies
    };
  }

  public async execute(accountIdStr: string, userIdStr: string): Promise<void> {
    const accountId = createAccountId(accountIdStr);
    const validatedUserId = validateUserId(userIdStr);

    if (!this.accountRepo.delete) {
      throw new Error('Account repository does not support permanent deletion.');
    }
    const deleteFn = this.accountRepo.delete.bind(this.accountRepo);

    const runDelete = async () => {
      // Recheck eligibility inside atomic unit of work right before deleting
      const eligibility = await this.checkEligibility(accountIdStr, userIdStr);
      if (!eligibility.canDelete) {
        throw new AccountDeletionBlockedError(accountId, eligibility.reasons);
      }

      const existing = await this.accountRepo.findById(accountId, validatedUserId);
      if (!existing) {
        throw new AccountNotFoundError(accountIdStr);
      }

      if (existing.userId !== validatedUserId) {
        throw new UnauthorizedEntityAccessError('Account', accountIdStr);
      }

      const now = new Date();
      const targetVersion = existing.version + 1;

      await deleteFn(accountId, validatedUserId);

      await this.syncPort.enqueue({
        userId: existing.userId,
        entity: 'accounts',
        entityId: accountId,
        operation: 'DELETE',
        payload: {
          id: accountId,
          user_id: existing.userId,
          expected_version: existing.version,
          version: targetVersion,
          deleted_at: now.toISOString()
        },
        idempotencyKey: crypto.randomUUID()
      });
    };

    if (this.unitOfWork) {
      await this.unitOfWork.run(runDelete);
    } else {
      await runDelete();
    }
  }
}
