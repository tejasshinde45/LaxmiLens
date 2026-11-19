import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { Transaction } from '@/domain/entities/Transaction';
import { Money } from '@/domain/value-objects/Money';
import { createTransactionId, createAccountId } from '@/domain/value-objects/Identifiers';
import { AccountNotFoundError, TransferAccountMismatchError } from '@/domain/errors/DomainErrors';
import { TransactionResponseDTO } from '@/application/dto/TransactionDTO';

export interface ExecuteTransferRequest {
  fromAccountId: string;
  toAccountId: string;
  amountInPaise: number;
  date: string;
  description: string;
  notes?: string;
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

    const now = new Date();
    const transactionId = createTransactionId(crypto.randomUUID());
    const idempotencyKey = req.idempotencyKey || crypto.randomUUID();

    const transferTx = new Transaction({
      id: transactionId,
      type: 'transfer',
      amount: Money.fromPaise(req.amountInPaise),
      accountId: fromAccount.id,
      targetAccountId: toAccount.id,
      date: new Date(req.date),
      description: req.description,
      notes: req.notes,
      status: 'cleared',
      idempotencyKey,
      version: 1,
      isDeleted: false,
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
        type: transferTx.type,
        amountInPaise: transferTx.amount.paise,
        accountId: transferTx.accountId,
        targetAccountId: transferTx.targetAccountId,
        date: transferTx.date.toISOString(),
        description: transferTx.description,
        status: transferTx.status,
        version: transferTx.version
      },
      idempotencyKey
    });

    return {
      id: transferTx.id,
      type: transferTx.type,
      amountInPaise: transferTx.amount.paise,
      amountFormatted: transferTx.amount.format(),
      accountId: transferTx.accountId,
      targetAccountId: transferTx.targetAccountId,
      date: transferTx.date.toISOString(),
      description: transferTx.description,
      notes: transferTx.notes,
      status: transferTx.status,
      idempotencyKey: transferTx.idempotencyKey,
      version: transferTx.version,
      createdAt: transferTx.createdAt.toISOString(),
      updatedAt: transferTx.updatedAt.toISOString()
    };
  }
}
