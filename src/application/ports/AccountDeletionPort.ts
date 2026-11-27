export interface AccountDeletionDependencies {
  activeTransactionCount: number;
  transferCount: number;
  softDeletedTransactionCount: number;
  activeRecurringRuleCount: number;
  deletedRecurringRuleCount: number;
  recurringOccurrenceCount: number;
  borrowingCount: number;
  repaymentCount: number;
  pendingAccountOutboxCount: number;
  pendingDependentOutboxCount: number;
}

export interface AccountDeletionDependencyInspector {
  inspect(accountId: string, userId: string): Promise<AccountDeletionDependencies>;
}
