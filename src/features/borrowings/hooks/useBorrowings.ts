import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import {
  BorrowingsOverviewResponseDTO,
  BorrowingsSummaryDTO
} from '@/application/dto/BorrowingDTO';
import {
  AddBorrowingFormValues,
  RecordRepaymentFormValues
} from '../schemas/borrowingSchemas';
import { OFFLINE_QUERY_STALE_TIME_MS } from '@/features/sync/utils/pendingOutboxQuery';
import { normalizeOptionalText } from '@/utils/textNormalization';

const emptySummary: BorrowingsSummaryDTO = {
  totalOutstandingPaise: 0,
  totalOutstandingFormatted: '₹0.00',
  totalBorrowedPaise: 0,
  totalBorrowedFormatted: '₹0.00',
  totalRepaidPaise: 0,
  totalRepaidFormatted: '₹0.00',
  activeLendersCount: 0,
  totalLendersCount: 0,
  activeBorrowingsCount: 0,
  totalBorrowingsCount: 0
};

export function useBorrowings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ['borrowings', user?.id];

  const {
    data,
    isLoading,
    isError,
    error,
    refetch
  } = useQuery<BorrowingsOverviewResponseDTO>({
    queryKey,
    queryFn: async () => {
      if (!user?.id) {
        return {
          summary: emptySummary,
          lenders: [],
          borrowings: [],
          repayments: []
        };
      }
      const repos = await defaultDatabaseManager.getActiveRepositories();
      return repos.getBorrowingsUseCase.execute(user.id);
    },
    enabled: !!user?.id,
    staleTime: OFFLINE_QUERY_STALE_TIME_MS,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false
  });

  const addBorrowingMutation = useMutation({
    mutationFn: async (values: AddBorrowingFormValues) => {
      if (!user?.id) throw new Error('You must be signed in to add a borrowing.');

      const parsedRupees = parseFloat(values.amount);
      const amountPaise = Math.round(parsedRupees * 100);

      const repos = await defaultDatabaseManager.getActiveRepositories();
      return repos.addBorrowingUseCase.execute({
        userId: user.id,
        lenderName: values.lenderName,
        lenderPhone: normalizeOptionalText(values.lenderPhone),
        lenderEmail: normalizeOptionalText(values.lenderEmail),
        amountPaise,
        borrowingDate: values.borrowingDate,
        dueDate: values.dueDate || null,
        receivingAccountId: values.receivingAccountId,
        notes: normalizeOptionalText(values.notes)
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['borrowings', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['transactions', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['reports', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['outbox', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['syncPendingCount', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['pendingOutboxTxIds', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['pendingOutboxEntries', user?.id] });
      toast.success(
        `Borrowing of ${data.amountFormatted} from ${data.lenderName} saved locally.`
      );
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to record borrowing.');
    }
  });

  const recordRepaymentMutation = useMutation({
    mutationFn: async (values: RecordRepaymentFormValues) => {
      if (!user?.id) throw new Error('You must be signed in to record a repayment.');

      const parsedRupees = parseFloat(values.amount);
      const amountPaise = Math.round(parsedRupees * 100);

      const repos = await defaultDatabaseManager.getActiveRepositories();
      return repos.recordRepaymentUseCase.execute({
        userId: user.id,
        lenderId: values.lenderId,
        borrowingId: values.borrowingId || undefined,
        amountPaise,
        repaymentDate: values.repaymentDate,
        paymentAccountId: values.paymentAccountId,
        notes: normalizeOptionalText(values.notes)
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['borrowings', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['transactions', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['reports', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['outbox', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['syncPendingCount', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['pendingOutboxTxIds', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['pendingOutboxEntries', user?.id] });
      toast.success(
        `Repayment of ${data.amountFormatted} to ${data.lenderName} saved locally.`
      );
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to record repayment.');
    }
  });

  return {
    summary: data?.summary ?? emptySummary,
    lenders: data?.lenders ?? [],
    borrowings: data?.borrowings ?? [],
    repayments: data?.repayments ?? [],
    isLoading,
    isError,
    error,
    refetch,
    addBorrowing: addBorrowingMutation.mutateAsync,
    isAddingBorrowing: addBorrowingMutation.isPending,
    recordRepayment: recordRepaymentMutation.mutateAsync,
    isRecordingRepayment: recordRepaymentMutation.isPending
  };
}
