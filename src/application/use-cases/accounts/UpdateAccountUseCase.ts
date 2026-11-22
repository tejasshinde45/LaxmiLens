import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { UpdateAccountDTO, AccountResponseDTO } from '@/application/dto/AccountDTO';
import { Account, AccountType } from '@/domain/entities/Account';
import { createAccountId, validateUserId } from '@/domain/value-objects/Identifiers';
import { AccountNotFoundError, UnauthorizedEntityAccessError } from '@/domain/errors/DomainErrors';

export class UpdateAccountUseCase {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  public async execute(dto: UpdateAccountDTO): Promise<AccountResponseDTO> {
    const accountId = createAccountId(dto.id);
    const existing = await this.accountRepo.findById(accountId);
    if (!existing) {
      throw new AccountNotFoundError(dto.id);
    }

    if (dto.userId !== undefined) {
      const validatedUserId = validateUserId(dto.userId);
      if (existing.userId !== validatedUserId) {
        throw new UnauthorizedEntityAccessError('Account', dto.id);
      }
    }

    const updated = new Account({
      id: existing.id,
      userId: existing.userId,
      name: dto.name ?? existing.name,
      accountType: (dto.accountType ?? existing.accountType) as AccountType,
      openingBalancePaise: existing.openingBalancePaise,
      currency: existing.currency,
      institutionName: dto.institutionName !== undefined ? dto.institutionName : existing.institutionName,
      color: dto.color ?? existing.color,
      icon: dto.icon ?? existing.icon,
      notes: dto.notes !== undefined ? dto.notes : existing.notes,
      isArchived: dto.isArchived ?? existing.isArchived,
      version: existing.version + 1,
      createdAt: existing.createdAt,
      updatedAt: new Date()
    });

    const outboxEntry = {
      userId: updated.userId,
      entity: 'accounts' as const,
      entityId: updated.id,
      operation: 'UPDATE' as const,
      payload: {
        id: updated.id,
        user_id: updated.userId,
        name: updated.name,
        account_type: updated.accountType,
        opening_balance_paise: updated.openingBalancePaise,
        institution_name: updated.institutionName,
        color: updated.color,
        icon: updated.icon,
        notes: updated.notes,
        is_archived: updated.isArchived,
        version: updated.version
      },
      idempotencyKey: crypto.randomUUID()
    };

    const persist = async () => {
      await this.accountRepo.save(updated);
      await this.syncPort.enqueue(outboxEntry);
    };

    if (this.unitOfWork) {
      await this.unitOfWork.run(persist);
    } else {
      await persist();
    }

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
      notes: updated.notes,
      isArchived: updated.isArchived,
      version: updated.version,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString()
    };
  }
}
