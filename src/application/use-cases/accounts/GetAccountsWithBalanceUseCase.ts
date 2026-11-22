import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { createUserId } from '@/domain/value-objects/Identifiers';
import { LedgerRules } from '@/domain/rules/LedgerRules';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';

export class GetAccountsWithBalanceUseCase {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly transactionRepo: TransactionRepository
  ) {}

  public async execute(userIdStr: string, includeArchived = true): Promise<AccountWithBalanceDTO[]> {
    const userId = createUserId(userIdStr);
    const accounts = await this.accountRepo.findByUserId(userId);

    const filtered = includeArchived ? accounts : accounts.filter((a) => !a.isArchived);

    const results: AccountWithBalanceDTO[] = [];

    for (const account of filtered) {
      const transactions = await this.transactionRepo.findByAccount(account.id);
      const currentBalance = LedgerRules.calculateAccountBalance(
        account.openingBalance,
        account.id,
        transactions
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
