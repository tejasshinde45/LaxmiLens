import React, { useState } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  Eye,
  Edit2,
  Trash2,
  MoreVertical,
  FileText,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/DropdownMenu';
import { TransactionResponseDTO } from '@/application/dto/TransactionDTO';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';
import { Category } from '@/domain/entities/Category';
import { formatDate } from '@/utils/formatters';
import { CategoryIcon } from '@/features/categories/components/CategoryIcon';
import { cn } from '@/utils/cn';

export interface TransactionTableProps {
  transactions: TransactionResponseDTO[];
  accounts: AccountWithBalanceDTO[];
  categories: Category[];
  pendingTxIdSet: Set<string>;
  isLoading: boolean;
  sortBy?: 'date' | 'amount';
  sortDirection?: 'desc' | 'asc';
  onSortChange?: (field: 'date' | 'amount') => void;
  onViewDetails: (tx: TransactionResponseDTO) => void;
  onEdit: (tx: TransactionResponseDTO) => void;
  onDelete: (tx: TransactionResponseDTO) => void;
  onRecordFirstTransaction?: () => void;
  hasFiltersApplied?: boolean;
}

const ITEMS_PER_PAGE = 25;

export const TransactionTable: React.FC<TransactionTableProps> = ({
  transactions,
  accounts,
  categories,
  pendingTxIdSet,
  isLoading,
  sortBy,
  sortDirection,
  onSortChange,
  onViewDetails,
  onEdit,
  onDelete,
  onRecordFirstTransaction,
  hasFiltersApplied = false
}) => {
  const [currentPage, setCurrentPage] = useState(1);

  const accountMap = new Map<string, AccountWithBalanceDTO>(accounts.map((a) => [a.id, a]));
  const categoryMap = new Map<string, Category>(categories.map((c) => [c.id, c]));

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Card key={i} variant="surface" className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <div className="space-y-1.5 text-right">
              <Skeleton className="h-4 w-20 ml-auto" />
              <Skeleton className="h-3 w-14 ml-auto" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <EmptyState
        icon={ArrowLeftRight}
        title={hasFiltersApplied ? 'No transactions found' : 'No transactions recorded yet'}
        description={
          hasFiltersApplied
            ? 'No ledger entries matched your active filters or search criteria. Try adjusting or resetting your filters.'
            : 'Your ledger is pristine. Record your first expense, income, or account transfer to begin tracking.'
        }
        actionLabel={!hasFiltersApplied && onRecordFirstTransaction ? 'Record Transaction' : undefined}
        onAction={!hasFiltersApplied && onRecordFirstTransaction ? onRecordFirstTransaction : undefined}
      />
    );
  }

  // Pagination calculation
  const totalPages = Math.ceil(transactions.length / ITEMS_PER_PAGE);
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * ITEMS_PER_PAGE;
  const paginatedTransactions = transactions.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  return (
    <div className="space-y-4">
      {/* Desktop Ledger Table (md and up) */}
      <div className="hidden md:block overflow-hidden rounded-[12px] border border-[#2B2B2B] bg-[#141414]">
        <table className="w-full text-left text-xs text-[#B9B4AA]">
          <thead className="border-b border-[#2B2B2B] bg-[#181818] text-[11px] font-medium uppercase tracking-wider text-[#858078]">
            <tr>
              <th
                className={cn(
                  'py-3 px-4 select-none',
                  onSortChange && 'cursor-pointer hover:text-[#F5F1E8] transition-colors'
                )}
                onClick={() => onSortChange?.('date')}
              >
                <div className="flex items-center gap-1">
                  <span>Date</span>
                  {sortBy === 'date' &&
                    (sortDirection === 'asc' ? (
                      <ArrowUp className="h-3 w-3 text-[#D6AD60]" />
                    ) : (
                      <ArrowDown className="h-3 w-3 text-[#D6AD60]" />
                    ))}
                </div>
              </th>
              <th className="py-3 px-4">Title / Note</th>
              <th className="py-3 px-4">Category / Flow</th>
              <th className="py-3 px-4">Account</th>
              <th className="py-3 px-4">Sync</th>
              <th
                className={cn(
                  'py-3 px-4 text-right select-none',
                  onSortChange && 'cursor-pointer hover:text-[#F5F1E8] transition-colors'
                )}
                onClick={() => onSortChange?.('amount')}
              >
                <div className="flex items-center justify-end gap-1">
                  <span>Amount</span>
                  {sortBy === 'amount' &&
                    (sortDirection === 'asc' ? (
                      <ArrowUp className="h-3 w-3 text-[#D6AD60]" />
                    ) : (
                      <ArrowDown className="h-3 w-3 text-[#D6AD60]" />
                    ))}
                </div>
              </th>
              <th className="py-3 px-4 text-right w-12">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#222222]">
            {paginatedTransactions.map((tx) => {
              const isIncome = tx.type === 'income';
              const isExpense = tx.type === 'expense';
              const isTransfer = tx.type === 'transfer';
              const isPending = pendingTxIdSet.has(tx.id);

              const sourceAccount = accountMap.get(tx.accountId);
              const destAccount = tx.destinationAccountId
                ? accountMap.get(tx.destinationAccountId)
                : undefined;
              const category = tx.categoryId ? categoryMap.get(tx.categoryId) : undefined;

              const amountColor = isIncome
                ? 'text-[#72B895]'
                : isExpense
                ? 'text-[#D9827C]'
                : 'text-[#82A9CF]';

              const amountSign = isIncome ? '+' : isExpense ? '-' : '';

              return (
                <tr
                  key={tx.id}
                  className="hover:bg-[#1A1A1A] transition-colors group cursor-pointer"
                  onClick={() => onViewDetails(tx)}
                >
                  {/* Date */}
                  <td className="py-3.5 px-4 whitespace-nowrap text-[#858078] font-tabular">
                    {formatDate(tx.transactionDate, 'dd MMM yyyy')}
                  </td>

                  {/* Title & Note Snippet */}
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[#F5F1E8] group-hover:text-[#D6AD60] transition-colors">
                        {tx.title || 'Untitled Transaction'}
                      </span>
                      {tx.note && (
                        <span title={tx.note}>
                          <FileText className="h-3 w-3 text-[#858078] shrink-0" />
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Category / Transfer Flow */}
                  <td className="py-3.5 px-4 whitespace-nowrap">
                    {isTransfer ? (
                      <Badge variant="transfer" size="sm">
                        Transfer
                      </Badge>
                    ) : category ? (
                      <div className="flex items-center gap-1.5">
                        <CategoryIcon
                          name={category.icon}
                          color={category.color}
                          className="h-3.5 w-3.5"
                        />
                        <span className="text-[#F5F1E8]">{category.name}</span>
                      </div>
                    ) : (
                      <span className="text-[#858078] italic">Uncategorized</span>
                    )}
                  </td>

                  {/* Account */}
                  <td className="py-3.5 px-4 whitespace-nowrap">
                    {isTransfer ? (
                      <div className="flex items-center gap-1.5">
                        <span>{sourceAccount?.name || 'Account'}</span>
                        <ArrowRight className="h-3 w-3 text-[#82A9CF]" />
                        <span>{destAccount?.name || 'Account'}</span>
                      </div>
                    ) : (
                      <span className="text-[#F5F1E8]">{sourceAccount?.name || 'Account'}</span>
                    )}
                  </td>

                  {/* Sync Status */}
                  <td className="py-3.5 px-4 whitespace-nowrap">
                    {isPending ? (
                      <Badge variant="warning" size="sm" dot>
                        Saved Locally
                      </Badge>
                    ) : (
                      <Badge variant="neutral" size="sm" dot>
                        Synced
                      </Badge>
                    )}
                  </td>

                  {/* Amount */}
                  <td className="py-3.5 px-4 text-right whitespace-nowrap">
                    <span className={cn('font-bold font-tabular text-sm', amountColor)}>
                      {amountSign}
                      {tx.amountFormatted}
                    </span>
                  </td>

                  {/* Actions Dropdown */}
                  <td
                    className="py-3.5 px-4 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-[#858078] hover:text-[#F5F1E8]"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-36">
                        <DropdownMenuItem onClick={() => onViewDetails(tx)}>
                          <Eye className="h-3.5 w-3.5 mr-2 text-[#858078]" />
                          Details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onEdit(tx)}>
                          <Edit2 className="h-3.5 w-3.5 mr-2 text-[#D6AD60]" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => onDelete(tx)}
                          className="text-[#D9827C] focus:text-[#D9827C] focus:bg-[#D9827C]/10"
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2 text-[#D9827C]" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Card List (below md) */}
      <div className="space-y-2 md:hidden">
        {paginatedTransactions.map((tx) => {
          const isIncome = tx.type === 'income';
          const isExpense = tx.type === 'expense';
          const isTransfer = tx.type === 'transfer';
          const isPending = pendingTxIdSet.has(tx.id);

          const sourceAccount = accountMap.get(tx.accountId);
          const destAccount = tx.destinationAccountId
            ? accountMap.get(tx.destinationAccountId)
            : undefined;
          const category = tx.categoryId ? categoryMap.get(tx.categoryId) : undefined;

          const amountColor = isIncome
            ? 'text-[#72B895]'
            : isExpense
            ? 'text-[#D9827C]'
            : 'text-[#82A9CF]';

          const amountSign = isIncome ? '+' : isExpense ? '-' : '';

          return (
            <Card
              key={tx.id}
              variant="surface"
              className="p-3.5 space-y-2.5 cursor-pointer hover:border-[#D6AD60]/40 transition-colors"
              onClick={() => onViewDetails(tx)}
            >
              {/* Header: Date & Badges */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#858078] font-tabular">
                  {formatDate(tx.transactionDate, 'dd MMM yyyy')}
                </span>
                <div className="flex items-center gap-1.5">
                  {isPending && (
                    <Badge variant="warning" size="sm" dot>
                      Saved Locally
                    </Badge>
                  )}
                  <Badge
                    variant={isIncome ? 'income' : isExpense ? 'expense' : 'transfer'}
                    size="sm"
                  >
                    {tx.type.toUpperCase()}
                  </Badge>
                </div>
              </div>

              {/* Middle: Title & Amount */}
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <h4 className="font-medium text-sm text-[#F5F1E8] leading-tight">
                    {tx.title || 'Untitled Transaction'}
                  </h4>
                  {tx.note && (
                    <p className="text-xs text-[#858078] line-clamp-1">{tx.note}</p>
                  )}
                </div>
                <div className={cn('text-base font-bold font-tabular shrink-0', amountColor)}>
                  {amountSign}
                  {tx.amountFormatted}
                </div>
              </div>

              {/* Bottom: Account and Category & Actions */}
              <div className="flex items-center justify-between pt-1 border-t border-[#222222] text-xs text-[#858078]">
                <div className="flex items-center gap-2 truncate max-w-[220px]">
                  {isTransfer ? (
                    <span className="truncate">
                      {sourceAccount?.name || 'Account'} → {destAccount?.name || 'Account'}
                    </span>
                  ) : (
                    <span>{sourceAccount?.name || 'Account'}</span>
                  )}
                  {category && (
                    <>
                      <span>•</span>
                      <span className="text-[#F5F1E8] truncate">{category.name}</span>
                    </>
                  )}
                </div>

                <div
                  className="flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit(tx)}
                    className="h-7 w-7 p-0 text-[#858078] hover:text-[#D6AD60]"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(tx)}
                    className="h-7 w-7 p-0 text-[#858078] hover:text-[#D9827C]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2 px-1 text-xs text-[#858078]">
          <span>
            Showing {startIndex + 1}–{Math.min(startIndex + ITEMS_PER_PAGE, transactions.length)} of{' '}
            {transactions.length} entries
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
              className="h-8 px-2.5 text-xs"
            >
              <ChevronLeft className="h-3.5 w-3.5 mr-1" />
              Prev
            </Button>
            <span className="px-2 font-tabular">
              {safePage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
              className="h-8 px-2.5 text-xs"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
