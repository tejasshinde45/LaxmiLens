import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { Transaction } from '@/domain/entities/Transaction';
import { createTransactionId, createAccountId, createUserId } from '@/domain/value-objects/Identifiers';
import { AccountNotFoundError, TransferAccountMismatchError } from '@/domain/errors/DomainErrors';
import { TransactionResponseDTO } from '@/application/dto/TransactionDTO';

export interface ExecuteTransferRequest {
  userId?: string;
  fromAccountId: string;
  toAccountId: string;
  amountInPaise?: number;
  amountPaise?: number;
  date?: string;
  transactionDate?: string;
  description?: string;
  title?: string;
  notes?: string;
  note?: string;
  idempotencyKey?: string;
}

export class ExecuteTransferUseCase {
  constructor(
    private readonly transactionRepo: TransactionRepository,
    private readonly accountRepo: AccountRepository,
    private readonly syncPort: SyncPort
  ) {}

  public async execute(req: ExecuteTransferRequest): Promise<TransactionResponseDTO> {
    if (req.fromAccountId === req.toAccountId) {
      throw new TransferAccountMismatchError();
    }

    const fromAccount = await this.accountRepo.findById(createAccountId(req.fromAccountId));
    if (!fromAccount) throw new AccountNotFoundError(req.fromAccountId);

    const toAccount = await this.accountRepo.findById(createAccountId(req.toAccountId));
    if (!toAccount) throw new AccountNotFoundError(req.toAccountId);

    const amountPaise = req.amountPaise ?? req.amountInPaise ?? 0;
    const resolvedTitle = (req.title || req.description || 'Account Transfer').trim();
    const resolvedDate = new Date(req.transactionDate || req.date || new Date().toISOString());
    const resolvedNote = req.note ?? req.notes;
    const idempotencyKey = req.idempotencyKey || crypto.randomUUID();
    const userId = createUserId(req.userId || fromAccount.userId);
    const now = new Date();
    const transactionId = createTransactionId(crypto.randomUUID());

    const transferTx = new Transaction({
      id: transactionId,
      userId,
      type: 'transfer',
      amountPaise,
      currency: fromAccount.currency,
      accountId: fromAccount.id,
      destinationAccountId: toAccount.id,
      title: resolvedTitle,
      note: resolvedNote,
      transactionDate: resolvedDate,
      deletedAt: null,
      status: 'cleared',
      idempotencyKey,
      version: 1,
      createdAt: now,
      updatedAt: now
    });

    // Save atomically in local store
    await this.transactionRepo.save(transferTx);

    // Enqueue to outbox for cloud sync
    await this.syncPort.enqueue({
      entity: 'transactions',
      entityId: transferTx.id,
      operation: 'INSERT',
      payload: {
        id: transferTx.id,
        user_id: transferTx.userId,
        type: transferTx.type,
        amount_paise: transferTx.amountPaise,
        currency: transferTx.currency,
        account_id: transferTx.accountId,
        destination_account_id: transferTx.destinationAccountId,
        title: transferTx.title,
        note: transferTx.note,
        transaction_date: transferTx.transactionDate.toISOString(),
        idempotency_key: transferTx.idempotencyKey,
        version: transferTx.version
      },
      idempotencyKey
    });

    return {
      id: transferTx.id,
      userId: transferTx.userId,
      type: transferTx.type,
      amountPaise: transferTx.amountPaise,
      amountFormatted: transferTx.amount.format(),
      currency: transferTx.currency,
      accountId: transferTx.accountId,
      destinationAccountId: transferTx.destinationAccountId,
      title: transferTx.title,
      note: transferTx.note,
      transactionDate: transferTx.transactionDate.toISOString(),
      deletedAt: null,
      isDeleted: false,
      status: transferTx.status,
      idempotencyKey: transferTx.idempotencyKey,
      version: transferTx.version,
      createdAt: transferTx.createdAt.toISOString(),
      updatedAt: transferTx.updatedAt.toISOString(),

      // Compatibility fields
      amountInPaise: transferTx.amountPaise,
      targetAccountId: transferTx.destinationAccountId,
      description: transferTx.title,
      notes: transferTx.note,
      date: transferTx.transactionDate.toISOString()
    };
  }
}
