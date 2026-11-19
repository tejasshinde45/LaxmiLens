import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { createAccountId } from '@/domain/value-objects/Identifiers';
import { AccountNotFoundError } from '@/domain/errors/DomainErrors';

export class ArchiveAccountUseCase {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly syncPort: SyncPort
  ) {}

  public async execute(accountIdStr: string): Promise<void> {
    const accountId = createAccountId(accountIdStr);
    const existing = await this.accountRepo.findById(accountId);
    if (!existing) {
      throw new AccountNotFoundError(accountIdStr);
    }

    await this.accountRepo.archive(accountId);

    await this.syncPort.enqueue({
      entity: 'accounts',
      entityId: accountId,
      operation: 'UPDATE',
      payload: {
        id: accountId,
        is_archived: true,
        version: existing.version + 1
      },
      idempotencyKey: crypto.randomUUID()
    });
  }
}
