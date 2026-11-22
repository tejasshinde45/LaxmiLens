import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { createTransactionId, validateUserId } from '@/domain/value-objects/Identifiers';
import { TransactionNotFoundError, UnauthorizedEntityAccessError } from '@/domain/errors/DomainErrors';

export class DeleteTransactionUseCase {
  constructor(
    private readonly transactionRepo: TransactionRepository,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork: UnitOfWork
  ) {}

  public async execute(transactionIdStr: string, userIdStr: string): Promise<void> {
    const validatedUserId = validateUserId(userIdStr);
    const txId = createTransactionId(transactionIdStr);
    const existing = await this.transactionRepo.findById(txId, validatedUserId);
    if (!existing) {
      throw new TransactionNotFoundError(transactionIdStr);
    }

    if (existing.userId !== validatedUserId) {
      throw new UnauthorizedEntityAccessError('Transaction', transactionIdStr);
    }

    if (existing.isDeleted) {
      // Idempotent: already soft-deleted
      return;
    }

    const now = new Date();
    const targetVersion = existing.version + 1;

    const outboxEntry = {
      userId: existing.userId,
      entity: 'transactions' as const,
      entityId: txId,
      operation: 'DELETE' as const,
      payload: {
        id: txId,
        user_id: existing.userId,
        deleted_at: now.toISOString(),
        version: targetVersion
      },
      idempotencyKey: crypto.randomUUID()
    };

    await this.unitOfWork.run(async () => {
      await this.transactionRepo.softDelete(txId, validatedUserId, now, targetVersion);
      await this.syncPort.enqueue(outboxEntry);
    });
  }
}
