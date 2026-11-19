import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { CreateAccountDTO, AccountResponseDTO } from '@/application/dto/AccountDTO';
import { Account, AccountType } from '@/domain/entities/Account';
import { createAccountId, createUserId } from '@/domain/value-objects/Identifiers';

export class CreateAccountUseCase {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly syncPort: SyncPort
  ) {}

  public async execute(dto: CreateAccountDTO): Promise<AccountResponseDTO> {
    const id = createAccountId(crypto.randomUUID());
    const userId = createUserId(dto.userId || 'local-user');
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
      isArchived: false,
      version: 1
    });

    await this.accountRepo.save(account);

    await this.syncPort.enqueue({
      entity: 'accounts',
      entityId: account.id,
      operation: 'INSERT',
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
        is_archived: account.isArchived,
        version: account.version
      },
      idempotencyKey: crypto.randomUUID()
    });

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
      isArchived: account.isArchived,
      version: account.version,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString()
    };
  }
}
