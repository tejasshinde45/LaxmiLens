import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { CreateTransactionDTO, TransactionResponseDTO } from '@/application/dto/TransactionDTO';
import { Transaction } from '@/domain/entities/Transaction';
import {
  createTransactionId,
  createAccountId,
  createCategoryId,
  createUserId
} from '@/domain/value-objects/Identifiers';
import {
  AccountNotFoundError,
  CategoryNotFoundError,
  CategoryTypeMismatchError,
  TransferAccountMismatchError,
  DuplicateTransactionError
} from '@/domain/errors/DomainErrors';

export class CreateTransactionUseCase {
  constructor(
    private readonly transactionRepo: TransactionRepository,
    private readonly accountRepo: AccountRepository,
    private readonly categoryRepo: CategoryRepository,
    private readonly syncPort: SyncPort
  ) {}

  public async execute(dto: CreateTransactionDTO): Promise<TransactionResponseDTO> {
    const userId = createUserId(dto.userId || 'local-user');
    const sourceAccountId = createAccountId(dto.accountId);
    const resolvedTitle = (dto.title || dto.description || '').trim();
    const resolvedDate = new Date(dto.transactionDate || dto.date || new Date().toISOString());
    const amountPaise = dto.amountPaise ?? dto.amountInPaise ?? 0;
    const idempotencyKey = (dto.idempotencyKey || crypto.randomUUID()).trim();

    // 1. Idempotency verification
    const existingTx = await this.transactionRepo.findByIdempotencyKey(idempotencyKey, userId);
    if (existingTx) {
      throw new DuplicateTransactionError(idempotencyKey);
    }

    // 2. Validate source account
    const sourceAccount = await this.accountRepo.findById(sourceAccountId);
    if (!sourceAccount) {
      throw new AccountNotFoundError(dto.accountId);
    }

    // 3. Validate transfer destination if type is transfer
    let destinationAccountId = dto.destinationAccountId || dto.targetAccountId;
    if (dto.type === 'transfer') {
      if (!destinationAccountId || destinationAccountId === dto.accountId) {
        throw new TransferAccountMismatchError();
      }
      const destAccount = await this.accountRepo.findById(createAccountId(destinationAccountId));
      if (!destAccount) {
        throw new AccountNotFoundError(destinationAccountId);
      }
    } else {
      destinationAccountId = undefined;
    }

    // 4. Validate category if provided
    let categoryId = dto.categoryId;
    if (categoryId && dto.type !== 'transfer') {
      const category = await this.categoryRepo.findById(createCategoryId(categoryId));
      if (!category) {
        throw new CategoryNotFoundError(categoryId);
      }
      if (category.type !== dto.type) {
        throw new CategoryTypeMismatchError(dto.type as 'income' | 'expense', category.type);
      }
    } else if (dto.type === 'transfer') {
      categoryId = undefined; // Transfers do not require or hold a category
    }

    const transactionId = createTransactionId(crypto.randomUUID());
    const now = new Date();

    const transaction = new Transaction({
      id: transactionId,
      userId,
      type: dto.type,
      amountPaise,
      currency: dto.currency || sourceAccount.currency || 'INR',
      accountId: sourceAccount.id,
      destinationAccountId: destinationAccountId ? createAccountId(destinationAccountId) : undefined,
      categoryId: categoryId ? createCategoryId(categoryId) : undefined,
      title: resolvedTitle,
      note: dto.note ?? dto.notes,
      transactionDate: resolvedDate,
      deletedAt: null,
      version: 1,
      deviceId: dto.deviceId,
      idempotencyKey,
      createdAt: now,
      updatedAt: now
    });

    // Save to local storage (Offline-First)
    await this.transactionRepo.save(transaction);

    // Enqueue to transactional outbox for cloud sync
    await this.syncPort.enqueue({
      entity: 'transactions',
      entityId: transaction.id,
      operation: 'INSERT',
      payload: {
        id: transaction.id,
        user_id: transaction.userId,
        type: transaction.type,
        amount_paise: transaction.amountPaise,
        currency: transaction.currency,
        account_id: transaction.accountId,
        destination_account_id: transaction.destinationAccountId,
        category_id: transaction.categoryId,
        title: transaction.title,
        note: transaction.note,
        transaction_date: transaction.transactionDate.toISOString(),
        idempotency_key: transaction.idempotencyKey,
        device_id: transaction.deviceId,
        version: transaction.version
      },
      idempotencyKey
    });

    return {
      id: transaction.id,
      userId: transaction.userId,
      type: transaction.type,
      amountPaise: transaction.amountPaise,
      amountFormatted: transaction.amount.format(),
      currency: transaction.currency,
      accountId: transaction.accountId,
      destinationAccountId: transaction.destinationAccountId,
      categoryId: transaction.categoryId,
      title: transaction.title,
      note: transaction.note,
      transactionDate: transaction.transactionDate.toISOString(),
      deletedAt: null,
      isDeleted: false,
      version: transaction.version,
      deviceId: transaction.deviceId,
      idempotencyKey: transaction.idempotencyKey,
      createdAt: transaction.createdAt.toISOString(),
      updatedAt: transaction.updatedAt.toISOString(),

      // Compatibility fields
      amountInPaise: transaction.amountPaise,
      targetAccountId: transaction.destinationAccountId,
      description: transaction.title,
      notes: transaction.note,
      date: transaction.transactionDate.toISOString(),
      status: transaction.status
    };
  }
}
