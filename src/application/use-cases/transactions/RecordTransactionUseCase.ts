import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { CreateTransactionDTO, TransactionResponseDTO } from '@/application/dto/TransactionDTO';
import { CreateTransactionUseCase } from './CreateTransactionUseCase';

/**
 * RecordTransactionUseCase
 * Facade maintaining backward compatibility with Milestone 1 calling conventions.
 */
export class RecordTransactionUseCase {
  private readonly createTxUseCase: CreateTransactionUseCase;

  constructor(
    transactionRepo: TransactionRepository,
    accountRepo: AccountRepository,
    syncPort: SyncPort,
    categoryRepo?: CategoryRepository
  ) {
    const fallbackCategoryRepo: CategoryRepository = categoryRepo || {
      findById: async () => null,
      findByUserId: async () => [],
      findAll: async () => [],
      save: async () => {},
      saveBatch: async () => {},
      archive: async () => {},
      seedDefaults: async () => []
    };

    this.createTxUseCase = new CreateTransactionUseCase(
      transactionRepo,
      accountRepo,
      fallbackCategoryRepo,
      syncPort
    );
  }

  public async execute(dto: CreateTransactionDTO): Promise<TransactionResponseDTO> {
    return this.createTxUseCase.execute(dto);
  }
}
