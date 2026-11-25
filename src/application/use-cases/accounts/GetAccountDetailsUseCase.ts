import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { createAccountId, validateUserId } from '@/domain/value-objects/Identifiers';
import { AccountNotFoundError, UnauthorizedEntityAccessError } from '@/domain/errors/DomainErrors';
import { LedgerRules } from '@/domain/rules/LedgerRules';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';

export interface AccountDetailsDTO extends AccountWithBalanceDTO {
  transactionCount: number;
}

export class GetAccountDetailsUseCase {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly transactionRepo: TransactionRepository
  ) {}

  public async execute(accountIdStr: string, userIdStr: string): Promise<AccountDetailsDTO> {
    const accountId = createAccountId(accountIdStr);
    const userId = validateUserId(userIdStr);

    const account = await this.accountRepo.findById(accountId, userId);
    if (!account) {
      throw new AccountNotFoundError(accountIdStr);
    }

    if (account.userId !== userId) {
      throw new UnauthorizedEntityAccessError('Account', accountIdStr);
    }

    const transactions = await this.transactionRepo.findByAccount(accountId, userId);
    const activeTransactions = transactions.filter((t) => !t.isDeleted);
    const currentBalance = LedgerRules.calculateAccountBalance(
      account.openingBalance,
      account.id,
      transactions
    );

    return {
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
      transactionCount: activeTransactions.length,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString()
    };
  }
}
