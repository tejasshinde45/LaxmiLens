import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { CreateAccountDTO, AccountResponseDTO } from '@/application/dto/AccountDTO';
import { Account, AccountType } from '@/domain/entities/Account';
import { createAccountId, validateUserId } from '@/domain/value-objects/Identifiers';
import { InvalidUserIdError } from '@/domain/errors/DomainErrors';

export class CreateAccountUseCase {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  public async execute(dto: CreateAccountDTO): Promise<AccountResponseDTO> {
    if (!dto.userId) {
      throw new InvalidUserIdError('A valid user UUID is required to create an account.');
    }
    const userId = validateUserId(dto.userId);

    const id = createAccountId(crypto.randomUUID());
    const accountType = (dto.accountType || dto.type || 'other') as AccountType;
    const openingBalancePaise = dto.openingBalancePaise ?? dto.openingBalanceInPaise ?? 0;
    const currency = dto.currency || 'INR';

    const account = new Account({
      id,
      userId,
      name: dto.name,
      accountType,
      openingBalancePaise,
      currency,
      institutionName: dto.institutionName,
      color: dto.color,
      icon: dto.icon,
      notes: dto.notes,
      isArchived: false,
      version: 1
    });

    const outboxEntry = {
      userId: account.userId,
      entity: 'accounts' as const,
      entityId: account.id,
      operation: 'INSERT' as const,
      payload: {
        id: account.id,
        user_id: account.userId,
        name: account.name,
        account_type: account.accountType,
        opening_balance_paise: account.openingBalancePaise,
        currency: account.currency,
        institution_name: account.institutionName,
        color: account.color,
        icon: account.icon,
        notes: account.notes,
        is_archived: account.isArchived,
        version: account.version
      },
      idempotencyKey: crypto.randomUUID()
    };

    const persist = async () => {
      await this.accountRepo.save(account);
      await this.syncPort.enqueue(outboxEntry);
    };

    if (this.unitOfWork) {
      await this.unitOfWork.run(persist);
    } else {
      await persist();
    }

    return {
      id: account.id,
      userId: account.userId,
      name: account.name,
      accountType: account.accountType,
      openingBalancePaise: account.openingBalancePaise,
      openingBalanceFormatted: account.openingBalance.format(),
      currency: account.currency,
      institutionName: account.institutionName,
      color: account.color,
      icon: account.icon,
      notes: account.notes,
      isArchived: account.isArchived,
      version: account.version,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString()
    };
  }
}
