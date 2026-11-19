import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { UpdateAccountDTO, AccountResponseDTO } from '@/application/dto/AccountDTO';
import { Account, AccountType } from '@/domain/entities/Account';
import { createAccountId } from '@/domain/value-objects/Identifiers';
import { AccountNotFoundError } from '@/domain/errors/DomainErrors';

export class UpdateAccountUseCase {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly syncPort: SyncPort
  ) {}

  public async execute(dto: UpdateAccountDTO): Promise<AccountResponseDTO> {
    const accountId = createAccountId(dto.id);
    const existing = await this.accountRepo.findById(accountId);
    if (!existing) {
      throw new AccountNotFoundError(dto.id);
    }

    const updated = new Account({
      id: existing.id,
      userId: existing.userId,
      name: dto.name ?? existing.name,
      accountType: (dto.accountType ?? existing.accountType) as AccountType,
      openingBalancePaise: existing.openingBalancePaise,
      currency: existing.currency,
      institutionName: dto.institutionName ?? existing.institutionName,
      color: dto.color ?? existing.color,
      icon: dto.icon ?? existing.icon,
      isArchived: dto.isArchived ?? existing.isArchived,
      version: existing.version + 1,
      createdAt: existing.createdAt,
      updatedAt: new Date()
    });

    await this.accountRepo.save(updated);

    await this.syncPort.enqueue({
      entity: 'accounts',
      entityId: updated.id,
      operation: 'UPDATE',
      payload: {
        id: updated.id,
        user_id: updated.userId,
        name: updated.name,
        account_type: updated.accountType,
        opening_balance_paise: updated.openingBalancePaise,
        institution_name: updated.institutionName,
        color: updated.color,
        icon: updated.icon,
        is_archived: updated.isArchived,
        version: updated.version
      },
      idempotencyKey: crypto.randomUUID()
    });

    return {
      id: updated.id,
      userId: updated.userId,
      name: updated.name,
      accountType: updated.accountType,
      openingBalancePaise: updated.openingBalancePaise,
      openingBalanceFormatted: updated.openingBalance.format(),
      currency: updated.currency,
      institutionName: updated.institutionName,
      color: updated.color,
      icon: updated.icon,
      isArchived: updated.isArchived,
      version: updated.version,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString()
    };
  }
}
