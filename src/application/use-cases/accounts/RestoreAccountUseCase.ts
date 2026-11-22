import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { createAccountId, validateUserId } from '@/domain/value-objects/Identifiers';
import { AccountNotFoundError, UnauthorizedEntityAccessError } from '@/domain/errors/DomainErrors';

export class RestoreAccountUseCase {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  public async execute(accountIdStr: string, userIdStr: string): Promise<void> {
    const accountId = createAccountId(accountIdStr);
    const validatedUserId = validateUserId(userIdStr);
    const existing = await this.accountRepo.findById(accountId, validatedUserId);
    if (!existing) {
      throw new AccountNotFoundError(accountIdStr);
    }

    if (existing.userId !== validatedUserId) {
      throw new UnauthorizedEntityAccessError('Account', accountIdStr);
    }

    const newVersion = existing.version + 1;

    const outboxEntry = {
      userId: existing.userId,
      entity: 'accounts' as const,
      entityId: accountId,
      operation: 'UPDATE' as const,
      payload: {
        id: accountId,
        user_id: existing.userId,
        is_archived: false,
        version: newVersion
      },
      idempotencyKey: crypto.randomUUID()
    };

    const persist = async () => {
      await this.accountRepo.restore(accountId, validatedUserId, newVersion);
      await this.syncPort.enqueue(outboxEntry);
    };

    if (this.unitOfWork) {
      await this.unitOfWork.run(persist);
    } else {
      await persist();
    }
  }
}
