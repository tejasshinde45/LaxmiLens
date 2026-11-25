import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import {
  createAccountId,
  createCategoryId,
  validateUserId
} from '@/domain/value-objects/Identifiers';
import { UnauthorizedEntityAccessError } from '@/domain/errors/DomainErrors';
import {
  AccountStatementReportDTO,
  CategoryReportDTO,
  FinancialSummaryReportDTO,
  ReportFilterCriteria,
  ReportTabType
} from '@/application/dto/ReportDTO';
import { FinancialReportService } from '@/application/services/FinancialReportService';

const NIL_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

export type FinancialReportDTO =
  | FinancialSummaryReportDTO
  | AccountStatementReportDTO
  | CategoryReportDTO;

export interface GenerateFinancialReportInput {
  userId: string;
  reportType: ReportTabType;
  filters: ReportFilterCriteria;
  now?: Date;
}

export interface GenerateSummaryReportInput {
  userId: string;
  reportType: 'summary';
  filters: ReportFilterCriteria;
  now?: Date;
}

export interface GenerateAccountStatementReportInput {
  userId: string;
  reportType: 'statement';
  filters: ReportFilterCriteria;
  now?: Date;
}

export interface GenerateCategoryReportInput {
  userId: string;
  reportType: 'category';
  filters: ReportFilterCriteria;
  now?: Date;
}

/**
 * GenerateFinancialReportUseCase
 *
 * Read-only application use case retrieving user-scoped ledger repositories,
 * enforcing strict tenant isolation, and delegating financial report computation
 * cleanly to FinancialReportService.
 */
export class GenerateFinancialReportUseCase {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly transactionRepo: TransactionRepository,
    private readonly categoryRepo: CategoryRepository
  ) {}

  public async execute(input: GenerateSummaryReportInput): Promise<FinancialSummaryReportDTO>;
  public async execute(
    input: GenerateAccountStatementReportInput
  ): Promise<AccountStatementReportDTO>;
  public async execute(input: GenerateCategoryReportInput): Promise<CategoryReportDTO>;
  public async execute(input: GenerateFinancialReportInput): Promise<FinancialReportDTO>;
  public async execute(input: GenerateFinancialReportInput): Promise<FinancialReportDTO> {
    const userId = validateUserId(input.userId);

    if (
      input.reportType !== 'summary' &&
      input.reportType !== 'statement' &&
      input.reportType !== 'category'
    ) {
      throw new Error(`Unsupported report type '${String(input.reportType)}'.`);
    }

    const [accounts, transactions, categories] = await Promise.all([
      this.accountRepo.findByUserId(userId),
      this.transactionRepo.findMany({ userId, includeDeleted: false }),
      this.categoryRepo.findByUserId(userId)
    ]);

    const ownedAccountIds = new Set<string>();
    for (const account of accounts) {
      if (account.userId !== userId) {
        throw new UnauthorizedEntityAccessError('Account', account.id);
      }
      ownedAccountIds.add(account.id);
    }

    for (const tx of transactions) {
      if (tx.userId !== userId) {
        throw new UnauthorizedEntityAccessError('Transaction', tx.id);
      }
    }

    const accessibleCategoryIds = new Set<string>();
    for (const category of categories) {
      const isSharedDefault =
        category.isDefault &&
        (!category.userId || category.userId === NIL_SYSTEM_USER_ID);
      if (category.userId !== userId && !isSharedDefault) {
        throw new UnauthorizedEntityAccessError('Category', category.id);
      }
      accessibleCategoryIds.add(category.id);
    }

    // Verify any explicitly requested missing filter IDs do not reference another user's records.
    const requestedAccountIds = new Set<string>();
    if (input.filters.statementAccountId?.trim()) {
      requestedAccountIds.add(input.filters.statementAccountId.trim());
    }
    for (const rawAccountId of input.filters.accountIds ?? []) {
      const trimmed = rawAccountId.trim();
      if (trimmed) {
        requestedAccountIds.add(trimmed);
      }
    }

    for (const accountId of requestedAccountIds) {
      if (!ownedAccountIds.has(accountId)) {
        const fetched = await this.accountRepo.findById(createAccountId(accountId), userId);
        if (fetched && fetched.userId !== userId) {
          throw new UnauthorizedEntityAccessError('Account', accountId);
        }
      }
    }

    for (const rawCategoryId of input.filters.categoryIds ?? []) {
      const trimmed = rawCategoryId.trim();
      if (!trimmed || trimmed === 'uncategorized') {
        continue;
      }
      if (!accessibleCategoryIds.has(trimmed)) {
        const fetched = await this.categoryRepo.findById(createCategoryId(trimmed), userId);
        const isSharedDefault =
          Boolean(fetched?.isDefault) &&
          (!fetched?.userId || fetched.userId === NIL_SYSTEM_USER_ID);
        if (fetched && fetched.userId !== userId && !isSharedDefault) {
          throw new UnauthorizedEntityAccessError('Category', trimmed);
        }
      }
    }

    const reportParams = {
      userId,
      accounts,
      transactions,
      categories,
      filters: input.filters,
      now: input.now
    };

    switch (input.reportType) {
      case 'summary':
        return FinancialReportService.generateFinancialSummary(reportParams);
      case 'statement':
        return FinancialReportService.generateAccountStatement(reportParams);
      case 'category':
        return FinancialReportService.generateCategoryReport(reportParams);
    }
  }
}
