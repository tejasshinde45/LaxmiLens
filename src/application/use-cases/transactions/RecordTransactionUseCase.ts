import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { CreateTransactionDTO, TransactionResponseDTO } from '@/application/dto/TransactionDTO';
import { Transaction } from '@/domain/entities/Transaction';
import { Money } from '@/domain/value-objects/Money';
import {
  createTransactionId,
  createAccountId,
  createCategoryId
} from '@/domain/value-objects/Identifiers';
import { AccountNotFoundError } from '@/domain/errors/DomainErrors';

export class RecordTransactionUseCase {
  constructor(
    private readonly transactionRepo: TransactionRepository,
    private readonly accountRepo: AccountRepository,
    private readonly syncPort: SyncPort
  ) {}

  public async execute(dto: CreateTransactionDTO): Promise<TransactionResponseDTO> {
    const account = await this.accountRepo.findById(createAccountId(dto.accountId));
    if (!account) {
      throw new AccountNotFoundError(dto.accountId);
    }

    const transactionId = createTransactionId(crypto.randomUUID());
    const idempotencyKey = dto.idempotencyKey || crypto.randomUUID();
    const now = new Date();

    const transaction = new Transaction({
      id: transactionId,
      type: dto.type,
      amount: Money.fromPaise(dto.amountInPaise),
      accountId: account.id,
      targetAccountId: dto.targetAccountId ? createAccountId(dto.targetAccountId) : undefined,
      categoryId: dto.categoryId ? createCategoryId(dto.categoryId) : undefined,
      date: new Date(dto.date),
      description: dto.description,
      notes: dto.notes,
      status: dto.status || 'cleared',
      idempotencyKey,
      version: 1,
      isDeleted: false,
      createdAt: now,
      updatedAt: now
    });

    // Save to local storage first (Offline-First)
    await this.transactionRepo.save(transaction);

    // Enqueue to transactional outbox for eventual cloud synchronization
    await this.syncPort.enqueue({
      entity: 'transactions',
      entityId: transaction.id,
      operation: 'INSERT',
      payload: {
        id: transaction.id,
        type: transaction.type,
        amountInPaise: transaction.amount.paise,
        accountId: transaction.accountId,
        targetAccountId: transaction.targetAccountId,
        categoryId: transaction.categoryId,
        date: transaction.date.toISOString(),
        description: transaction.description,
        notes: transaction.notes,
        status: transaction.status,
        version: transaction.version
      },
      idempotencyKey
    });

    return {
      id: transaction.id,
      type: transaction.type,
      amountInPaise: transaction.amount.paise,
      amountFormatted: transaction.amount.format(),
      accountId: transaction.accountId,
      targetAccountId: transaction.targetAccountId,
      categoryId: transaction.categoryId,
      date: transaction.date.toISOString(),
      description: transaction.description,
      notes: transaction.notes,
      status: transaction.status,
      idempotencyKey: transaction.idempotencyKey,
      version: transaction.version,
      createdAt: transaction.createdAt.toISOString(),
      updatedAt: transaction.updatedAt.toISOString()
    };
  }
}
