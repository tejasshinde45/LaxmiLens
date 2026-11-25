export interface CreateBudgetDTO {
  userId: string;
  categoryId: string;
  period: string; // YYYY-MM
  limitPaise?: number;

  // Compatibility alias
  limitInPaise?: number;
}

export interface UpdateBudgetDTO {
  id: string;
  userId: string;
  limitPaise?: number;

  // Compatibility alias
  limitInPaise?: number;
}

export interface BudgetResponseDTO {
  id: string;
  userId: string;
  categoryId: string;
  period: string;
  limitPaise: number;
  limitFormatted: string;
  version: number;
  createdAt: string;
  updatedAt: string;

  // Compatibility alias
  limitInPaise: number;
}

export interface BudgetStatusDTO {
  budgetId: string;
  userId: string;
  categoryId: string;
  period: string;
  limitPaise: number;
  limitFormatted: string;
  spentPaise: number;
  spentFormatted: string;
  remainingPaise: number;
  remainingFormatted: string;
  utilizationPercentage: number;
  isExceeded: boolean;

  // Compatibility aliases
  limitInPaise: number;
  spentInPaise: number;
  remainingInPaise: number;
  percentageUsed: number;
}

export interface BudgetOverviewItemDTO {
  budgetId: string;
  userId: string;
  categoryId: string;
  categoryName: string;
  categoryIcon?: string;
  categoryColor?: string;
  categoryIsArchived: boolean;
  period: string;
  limitPaise: number;
  limitFormatted: string;
  spentPaise: number;
  spentFormatted: string;
  remainingPaise: number;
  remainingFormatted: string;
  utilizationPercentage: number;
  isExceeded: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetsOverviewSummaryDTO {
  period: string;
  totalBudgetLimitPaise: number;
  totalBudgetLimitFormatted: string;
  totalSpentPaise: number;
  totalSpentFormatted: string;
  totalRemainingPaise: number;
  totalRemainingFormatted: string;
  overallUtilizationPercentage: number;
  budgetCount: number;
  exceededCount: number;
}

export interface BudgetsOverviewResponseDTO {
  period: string;
  summary: BudgetsOverviewSummaryDTO;
  budgets: BudgetOverviewItemDTO[];
}
