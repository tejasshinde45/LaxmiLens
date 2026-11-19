import { AccountId } from '../value-objects/Identifiers';
import { Money } from '../value-objects/Money';
import { Transaction } from '../entities/Transaction';
import { Account } from '../entities/Account';

export interface LedgerTotals {
  totalIncome: Money;
  totalExpense: Money;
  netSavings: Money;
  transactionCount: number;
}

export class LedgerRules {
  /**
   * Derives an account's current balance strictly from its opening balance
   * and the sequence of verified ledger transactions.
   *
   * Formula:
   * Balance = OpeningBalance + Sum(Income) - Sum(Expense) - Sum(Transfers Out) + Sum(Transfers In)
   *
   * Note on Negative Balances:
   * Negative balances are legitimate in financial accounting (e.g., credit card debt,
   * overdraft facilities, or temporary cash deficits). Negative balances do not cause
   * errors and are accurately represented by signed integer paise in the Money object.
   */
  public static calculateAccountBalance(
    openingBalance: Money,
    accountId: AccountId,
    transactions: readonly Transaction[]
  ): Money {
    let current = openingBalance;

    for (const tx of transactions) {
      // Exclude soft-deleted transactions
      if (tx.isDeleted) continue;

      if (tx.type === 'income' && tx.accountId === accountId) {
        current = current.add(tx.amount);
      } else if (tx.type === 'expense' && tx.accountId === accountId) {
        current = current.subtract(tx.amount);
      } else if (tx.type === 'transfer') {
        const destId = tx.destinationAccountId || tx.targetAccountId;
        if (tx.accountId === accountId) {
          // Outgoing transfer reduces source account
          current = current.subtract(tx.amount);
        } else if (destId === accountId) {
          // Incoming transfer increases destination account
          current = current.add(tx.amount);
        }
      }
    }

    return current;
  }

  /**
   * Calculates overall cashflow totals across transactions.
   * Transfers between accounts are strictly excluded from income and expenses
   * because they represent liquidity reallocation rather than external cashflow.
   */
  public static calculateTotals(transactions: readonly Transaction[]): LedgerTotals {
    let totalIncome = Money.zero();
    let totalExpense = Money.zero();
    let activeCount = 0;

    for (const tx of transactions) {
      if (tx.isDeleted) continue;
      activeCount++;

      if (tx.type === 'income') {
        totalIncome = totalIncome.add(tx.amount);
      } else if (tx.type === 'expense') {
        totalExpense = totalExpense.add(tx.amount);
      }
      // Transfers are neutral to total cashflow
    }

    return {
      totalIncome,
      totalExpense,
      netSavings: totalIncome.subtract(totalExpense),
      transactionCount: activeCount
    };
  }

  /**
   * Derives net worth across all active accounts.
   * Asset accounts (Cash, Bank, Savings, Wallet) add to net worth.
   * Credit card accounts subtract owed debt.
   * Archived accounts are excluded from current net worth, though their historical
   * records remain preserved.
   */
  public static calculateNetWorth(
    accountBalances: readonly { account: Account; balance: Money }[]
  ): Money {
    let total = Money.zero();

    for (const { account, balance } of accountBalances) {
      if (account.isArchived) continue;

      if (account.isCreditCard()) {
        total = total.subtract(balance);
      } else {
        total = total.add(balance);
      }
    }

    return total;
  }
}
