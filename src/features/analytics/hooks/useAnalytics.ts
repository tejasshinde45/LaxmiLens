import { useMemo, useState } from 'react';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useTransactions } from '@/features/transactions/hooks/useTransactions';
import { useCategories } from '@/features/categories/hooks/useCategories';
import {
  AnalyticsDatePreset,
  CustomDateRangeInput,
  FinancialAnalyticsResult,
  FinancialAnalyticsService,
  formatLocalDateInput,
  parseLocalDateInput
} from '@/application/services/FinancialAnalyticsService';

export function useAnalytics() {
  let user: { id: string } | null = null;
  try {
    const auth = useAuth();
    user = auth.user;
  } catch {
    user = null;
  }

  const {
    transactions,
    isLoading: isTxLoading,
    isError: isTxError,
    error: txError,
    refetch: refetchTransactions
  } = useTransactions();

  const {
    categories,
    isLoading: isCategoriesLoading,
    isError: isCatError,
    error: catError,
    refetch: refetchCategories
  } = useCategories();

  const [preset, setPreset] = useState<AnalyticsDatePreset>('this_month');
  const [customRange, setCustomRange] = useState<CustomDateRangeInput>(() => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      startDate: formatLocalDateInput(startOfMonth),
      endDate: formatLocalDateInput(now)
    };
  });

  const dateRangeError = useMemo(() => {
    if (preset !== 'custom') return null;
    try {
      const s = parseLocalDateInput(customRange.startDate);
      const e = parseLocalDateInput(customRange.endDate);
      if (s.getTime() > e.getTime()) {
        return 'Start date must be on or before end date.';
      }
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Enter valid custom start and end dates.';
    }
  }, [preset, customRange]);

  const analytics: FinancialAnalyticsResult | null = useMemo(() => {
    if (!user?.id) return null;
    if (dateRangeError) return null;

    return FinancialAnalyticsService.analyze({
      userId: user.id,
      transactions,
      categories,
      preset,
      customRange
    });
  }, [user?.id, transactions, categories, preset, customRange, dateRangeError]);

  const refetch = async () => {
    await Promise.all([refetchTransactions(), refetchCategories()]);
  };

  return {
    preset,
    setPreset,
    customRange,
    setCustomRange,
    dateRangeError,
    analytics,
    isLoading: isTxLoading || isCategoriesLoading,
    isError: isTxError || isCatError,
    error: txError || catError,
    refetch
  };
}
