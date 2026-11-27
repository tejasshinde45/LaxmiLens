import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { Transaction } from '@/domain/entities/Transaction';
import { validateUserId } from '@/domain/value-objects/Identifiers';
import { LedgerRules } from '@/domain/rules/LedgerRules';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';

export class GetAccountsWithBalanceUseCase {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly transactionRepo: TransactionRepository
  ) {}

  public async execute(userIdStr: string, includeArchived = true): Promise<AccountWithBalanceDTO[]> {
    const userId = validateUserId(userIdStr);
    const accounts = await this.accountRepo.findByUserId(userId);

    const filtered = includeArchived ? accounts : accounts.filter((a) => !a.isArchived);
    if (filtered.length === 0) {
      return [];
    }

    // Bulk-retrieve active user transactions once rather than issuing per-account findByAccount queries (1 + 2N -> 2).
    const transactions = await this.transactionRepo.findMany({
      userId,
      includeDeleted: false
    });

    const transactionsByAccount = new Map<string, Transaction[]>();
    const addToBucket = (accountId: string, tx: Transaction) => {
      let bucket = transactionsByAccount.get(accountId);
      if (!bucket) {
        bucket = [];
        transactionsByAccount.set(accountId, bucket);
      }
      bucket.push(tx);
    };

    for (const tx of transactions) {
      if (tx.isDeleted) continue;
      addToBucket(tx.accountId, tx);

      if (tx.type === 'transfer') {
        const destId = tx.destinationAccountId || tx.targetAccountId;
        if (destId && destId !== tx.accountId) {
          addToBucket(destId, tx);
        }
      }
    }

    const results: AccountWithBalanceDTO[] = [];

    for (const account of filtered) {
      const accountTransactions = transactionsByAccount.get(account.id) ?? [];
      const currentBalance = LedgerRules.calculateAccountBalance(
        account.openingBalance,
        account.id,
        accountTransactions
      );

      results.push({
        id: account.id,
        userId: account.userId,
        name: account.name,
        accountType: account.accountType,
        openingBalancePaise: account.openingBalancePaise,
        openingBalanceFormatted: account.openingBalance.format(),
        currentBalancePaise: currentBalance.paise,
        currentBalanceFormatted: currentBalance.format(),
        currency: account.currency,
        institutionName: account.institutionName,
        color: account.color,
        icon: account.icon,
        notes: account.notes,
        systemTag: account.systemTag,
        isArchived: account.isArchived,
        isCreditCard: account.isCreditCard(),
        version: account.version,
        createdAt: account.createdAt.toISOString(),
        updatedAt: account.updatedAt.toISOString()
      });
    }

    // Sort: active accounts first, then alphabetically by name
    return results.sort((a, b) => {
      if (a.isArchived !== b.isArchived) {
        return a.isArchived ? 1 : -1;
      }
      return a.name.localeCompare(b.name);
    });
  }
}
