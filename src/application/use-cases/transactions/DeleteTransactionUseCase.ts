import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { createTransactionId } from '@/domain/value-objects/Identifiers';
import { TransactionNotFoundError } from '@/domain/errors/DomainErrors';

export class DeleteTransactionUseCase {
  constructor(
    private readonly transactionRepo: TransactionRepository,
    private readonly syncPort: SyncPort
  ) {}

  public async execute(transactionIdStr: string): Promise<void> {
    const txId = createTransactionId(transactionIdStr);
    const existing = await this.transactionRepo.findById(txId);
    if (!existing) {
      throw new TransactionNotFoundError(transactionIdStr);
    }

    const now = new Date();
    await this.transactionRepo.softDelete(txId, now);

    await this.syncPort.enqueue({
      entity: 'transactions',
      entityId: txId,
      operation: 'DELETE',
      payload: {
        id: txId,
        deleted_at: now.toISOString(),
        version: existing.version + 1
      },
      idempotencyKey: crypto.randomUUID()
    });
  }
}
