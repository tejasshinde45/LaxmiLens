import { Account } from '../entities/Account';
import { Transaction } from '../entities/Transaction';
import { Money } from '../value-objects/Money';
import { LedgerRules, LedgerTotals } from '../rules/LedgerRules';

export class BalanceService {
  public static computeAccountBalance(account: Account, transactions: readonly Transaction[]): Money {
    return LedgerRules.calculateAccountBalance(account.openingBalance, account.id, transactions);
  }

  public static computeTotals(transactions: readonly Transaction[]): LedgerTotals {
    return LedgerRules.calculateTotals(transactions);
  }

  public static computeNetWorth(accountBalances: readonly { account: Account; balance: Money }[]): Money {
    return LedgerRules.calculateNetWorth(accountBalances);
  }
}
