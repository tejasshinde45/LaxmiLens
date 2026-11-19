import { Account } from '../entities/Account';
import { Transaction } from '../entities/Transaction';
import { Money } from '../value-objects/Money';
import { LedgerRules } from '../rules/LedgerRules';

export class BalanceService {
  public static computeAccountBalance(account: Account, transactions: readonly Transaction[]): Money {
    return LedgerRules.calculateAccountBalance(account.openingBalance, account.id, transactions);
  }
}
