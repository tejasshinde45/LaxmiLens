import { TransactionRepository, TransactionFilter } from '@/domain/repositories/TransactionRepository';
import { TransactionResponseDTO } from '@/application/dto/TransactionDTO';

export class GetTransactionsUseCase {
  constructor(private readonly transactionRepo: TransactionRepository) {}

  public async execute(filter: TransactionFilter = {}): Promise<TransactionResponseDTO[]> {
    const transactions = await this.transactionRepo.findMany(filter);

    return transactions.map((tx) => ({
      id: tx.id,
      userId: tx.userId,
      type: tx.type,
      amountPaise: tx.amountPaise,
      amountFormatted: tx.amount.format(),
      currency: tx.currency,
      accountId: tx.accountId,
      destinationAccountId: tx.destinationAccountId,
      categoryId: tx.categoryId,
      title: tx.title,
      note: tx.note,
      transactionDate: tx.transactionDate.toISOString(),
      deletedAt: tx.deletedAt ? tx.deletedAt.toISOString() : null,
      isDeleted: tx.isDeleted,
      version: tx.version,
      deviceId: tx.deviceId,
      idempotencyKey: tx.idempotencyKey,
      createdAt: tx.createdAt.toISOString(),
      updatedAt: tx.updatedAt.toISOString(),

      // Compatibility fields
      amountInPaise: tx.amountPaise,
      targetAccountId: tx.destinationAccountId,
      description: tx.title,
      notes: tx.note,
      date: tx.transactionDate.toISOString(),
      status: tx.status
    }));
  }
}
