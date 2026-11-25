import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { Account } from '@/domain/entities/Account';
import { createAccountId, validateUserId } from '@/domain/value-objects/Identifiers';

export const PERSONAL_BORROWINGS_ACCOUNT_NAME = 'Personal Borrowings';
export const PERSONAL_BORROWINGS_SYSTEM_TAG = 'personal_borrowings';

export class EnsurePersonalBorrowingsAccountUseCase {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork: UnitOfWork
  ) {}

  public async execute(userIdInput: string): Promise<Account> {
    const userId = validateUserId(userIdInput);
    const accounts = await this.accountRepo.findByUserId(userId);

    const existing = accounts.find(
      (a) => a.systemTag === PERSONAL_BORROWINGS_SYSTEM_TAG
    );

    if (existing) {
      return existing;
    }

    const now = new Date();
    const accountId = createAccountId(crypto.randomUUID());
    const idempotencyKey = crypto.randomUUID();

    const newAccount = new Account({
      id: accountId,
      userId,
      name: PERSONAL_BORROWINGS_ACCOUNT_NAME,
      accountType: 'other',
      openingBalancePaise: 0,
      currency: 'INR',
      color: '#D6AD60',
      icon: 'hand-coins',
      notes: 'Aggregate liability account for personal borrowings',
      systemTag: PERSONAL_BORROWINGS_SYSTEM_TAG,
      isArchived: false,
      version: 1,
      createdAt: now,
      updatedAt: now
    });

    const outboxPayload = {
      id: newAccount.id,
      user_id: newAccount.userId,
      name: newAccount.name,
      account_type: newAccount.accountType,
      opening_balance_paise: newAccount.openingBalancePaise,
      currency: newAccount.currency,
      institution_name: null,
      color: newAccount.color ?? null,
      icon: newAccount.icon ?? null,
      notes: newAccount.notes ?? null,
      system_tag: PERSONAL_BORROWINGS_SYSTEM_TAG,
      is_archived: false,
      version: newAccount.version
    };

    await this.unitOfWork.run(async () => {
      await this.accountRepo.save(newAccount);
      await this.syncPort.enqueue({
        userId,
        entity: 'accounts',
        entityId: newAccount.id,
        operation: 'INSERT',
        payload: outboxPayload,
        idempotencyKey
      });
    });

    return newAccount;
  }
}
