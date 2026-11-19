import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { createAccountId } from '@/domain/value-objects/Identifiers';
import { AccountNotFoundError } from '@/domain/errors/DomainErrors';
import { LedgerRules } from '@/domain/rules/LedgerRules';
import { AccountBalanceDTO } from '@/application/dto/AccountDTO';

export class GetAccountBalanceUseCase {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly transactionRepo: TransactionRepository
  ) {}

  public async execute(accountIdStr: string): Promise<AccountBalanceDTO> {
    const accountId = createAccountId(accountIdStr);
    const account = await this.accountRepo.findById(accountId);
    if (!account) {
      throw new AccountNotFoundError(accountIdStr);
    }

    // Retrieve ledger transactions for this account (soft-deleted are handled by LedgerRules)
    const transactions = await this.transactionRepo.findByAccount(accountId);
    const currentBalance = LedgerRules.calculateAccountBalance(
      account.openingBalance,
      account.id,
      transactions
    );

    return {
      accountId: account.id,
      accountName: account.name,
      accountType: account.accountType,
      currency: account.currency,
      openingBalancePaise: account.openingBalancePaise,
      currentBalancePaise: currentBalance.paise,
      currentBalanceFormatted: currentBalance.format(),
      isCreditCard: account.isCreditCard(),
      isArchived: account.isArchived,

      // Compatibility fields
      openingBalanceInPaise: account.openingBalancePaise,
      currentBalanceInPaise: currentBalance.paise
    };
  }
}
