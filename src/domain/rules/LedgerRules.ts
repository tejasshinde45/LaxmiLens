import { AccountId } from '../value-objects/Identifiers';
import { Money } from '../value-objects/Money';
import { Transaction } from '../entities/Transaction';
import { Account } from '../entities/Account';

export class LedgerRules {
  /**
   * Strictly derives an account's current balance from its opening balance
   * and the sequence of verified ledger transactions.
   *
   * Formula:
   * Balance = OpeningBalance + Sum(Income) - Sum(Expense) - Sum(Transfers Out) + Sum(Transfers In)
   */
  public static calculateAccountBalance(
    openingBalance: Money,
    accountId: AccountId,
    transactions: readonly Transaction[]
  ): Money {
    let current = openingBalance;

    for (const tx of transactions) {
      if (tx.isDeleted) continue;

      if (tx.type === 'income' && tx.accountId === accountId) {
        current = current.add(tx.amount);
      } else if (tx.type === 'expense' && tx.accountId === accountId) {
        current = current.subtract(tx.amount);
      } else if (tx.type === 'transfer') {
        if (tx.accountId === accountId) {
          // Source account debited
          current = current.subtract(tx.amount);
        } else if (tx.targetAccountId === accountId) {
          // Destination account credited
          current = current.add(tx.amount);
        }
      }
    }

    return current;
  }

  /**
   * Derives net worth across all active accounts.
   * Standard asset accounts add to net worth, credit cards subtract debt.
   */
  public static calculateNetWorth(
    accountBalances: readonly { account: Account; balance: Money }[]
  ): Money {
    let total = Money.zero();

    for (const { account, balance } of accountBalances) {
      if (account.isArchived()) continue;

      if (account.isCreditCard()) {
        // Credit card balance is typically owed debt (liability)
        total = total.subtract(balance);
      } else {
        total = total.add(balance);
      }
    }

    return total;
  }
}
