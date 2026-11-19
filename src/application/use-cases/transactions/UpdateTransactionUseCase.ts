import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { UpdateTransactionDTO, TransactionResponseDTO } from '@/application/dto/TransactionDTO';
import { Transaction } from '@/domain/entities/Transaction';
import {
  createTransactionId,
  createAccountId,
  createCategoryId
} from '@/domain/value-objects/Identifiers';
import {
  TransactionNotFoundError,
  AccountNotFoundError,
  CategoryNotFoundError,
  CategoryTypeMismatchError,
  TransferAccountMismatchError
} from '@/domain/errors/DomainErrors';

export class UpdateTransactionUseCase {
  constructor(
    private readonly transactionRepo: TransactionRepository,
    private readonly accountRepo: AccountRepository,
    private readonly categoryRepo: CategoryRepository,
    private readonly syncPort: SyncPort
  ) {}

  public async execute(dto: UpdateTransactionDTO): Promise<TransactionResponseDTO> {
    const txId = createTransactionId(dto.id);
    const existing = await this.transactionRepo.findById(txId);
    if (!existing) {
      throw new TransactionNotFoundError(dto.id);
    }

    const resolvedAmountPaise = dto.amountPaise ?? dto.amountInPaise ?? existing.amountPaise;
    const resolvedAccountId = dto.accountId ? createAccountId(dto.accountId) : existing.accountId;
    let resolvedDestinationId = dto.destinationAccountId || dto.targetAccountId;
    const resolvedTitle = (dto.title || dto.description || existing.title).trim();
    const resolvedDate = new Date(dto.transactionDate || dto.date || existing.transactionDate);
    const resolvedNote = (dto.note ?? dto.notes) ?? existing.note;

    // Validate account if changed
    if (dto.accountId) {
      const acc = await this.accountRepo.findById(resolvedAccountId);
      if (!acc) throw new AccountNotFoundError(dto.accountId);
    }

    // Validate destination if transfer
    if (existing.type === 'transfer') {
      const destId = resolvedDestinationId ? createAccountId(resolvedDestinationId) : existing.destinationAccountId;
      if (!destId || destId === resolvedAccountId) {
        throw new TransferAccountMismatchError();
      }
      const destAcc = await this.accountRepo.findById(destId);
      if (!destAcc) throw new AccountNotFoundError(destId);
      resolvedDestinationId = destId;
    } else {
      resolvedDestinationId = undefined;
    }

    // Validate category if provided
    let resolvedCategoryId = dto.categoryId !== undefined
      ? (dto.categoryId ? createCategoryId(dto.categoryId) : undefined)
      : existing.categoryId;

    if (resolvedCategoryId && existing.type !== 'transfer') {
      const cat = await this.categoryRepo.findById(resolvedCategoryId);
      if (!cat) throw new CategoryNotFoundError(resolvedCategoryId);
      if (cat.type !== existing.type) {
        throw new CategoryTypeMismatchError(existing.type as 'income' | 'expense', cat.type);
      }
    } else if (existing.type === 'transfer') {
      resolvedCategoryId = undefined;
    }

    const updated = new Transaction({
      id: existing.id,
      userId: existing.userId,
      type: existing.type,
      amountPaise: resolvedAmountPaise,
      currency: existing.currency,
      accountId: resolvedAccountId,
      destinationAccountId: resolvedDestinationId ? createAccountId(resolvedDestinationId) : undefined,
      categoryId: resolvedCategoryId,
      title: resolvedTitle,
      note: resolvedNote,
      transactionDate: resolvedDate,
      deletedAt: existing.deletedAt,
      version: existing.version + 1,
      deviceId: existing.deviceId,
      idempotencyKey: existing.idempotencyKey,
      createdAt: existing.createdAt,
      updatedAt: new Date()
    });

    await this.transactionRepo.save(updated);

    await this.syncPort.enqueue({
      entity: 'transactions',
      entityId: updated.id,
      operation: 'UPDATE',
      payload: {
        id: updated.id,
        user_id: updated.userId,
        type: updated.type,
        amount_paise: updated.amountPaise,
        currency: updated.currency,
        account_id: updated.accountId,
        destination_account_id: updated.destinationAccountId,
        category_id: updated.categoryId,
        title: updated.title,
        note: updated.note,
        transaction_date: updated.transactionDate.toISOString(),
        version: updated.version
      },
      idempotencyKey: crypto.randomUUID()
    });

    return {
      id: updated.id,
      userId: updated.userId,
      type: updated.type,
      amountPaise: updated.amountPaise,
      amountFormatted: updated.amount.format(),
      currency: updated.currency,
      accountId: updated.accountId,
      destinationAccountId: updated.destinationAccountId,
      categoryId: updated.categoryId,
      title: updated.title,
      note: updated.note,
      transactionDate: updated.transactionDate.toISOString(),
      deletedAt: updated.deletedAt ? updated.deletedAt.toISOString() : null,
      isDeleted: updated.isDeleted,
      version: updated.version,
      deviceId: updated.deviceId,
      idempotencyKey: updated.idempotencyKey,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),

      // Compatibility fields
      amountInPaise: updated.amountPaise,
      targetAccountId: updated.destinationAccountId,
      description: updated.title,
      notes: updated.note,
      date: updated.transactionDate.toISOString(),
      status: updated.status
    };
  }
}
