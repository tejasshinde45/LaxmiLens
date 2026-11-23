import { useQuery } from '@tanstack/react-query';
import { queryClient as globalQueryClient } from '@/lib/queryClient';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import { DexieCategoryRepository } from '@/infrastructure/database/local/repositories/DexieCategoryRepository';
import { Category } from '@/domain/entities/Category';
import { createUserId } from '@/domain/value-objects/Identifiers';

// Fallback singleton repository for test/isolated contexts
const fallbackCategoryRepo = new DexieCategoryRepository();

export function useCategories(client = globalQueryClient) {
  let user: { id: string } | null = null;
  try {
    const auth = useAuth();
    user = auth.user;
  } catch {
    user = null;
  }

  const queryKey = ['categories', user?.id];

  const {
    data: categories = [],
    isLoading,
    isError,
    error,
    refetch
  } = useQuery<Category[]>(
    {
      queryKey,
      queryFn: async () => {
        if (!user?.id) return [];
        const validatedUserId = createUserId(user.id);
        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          let cats = await repos.categoryRepo.findByUserId(validatedUserId);
          if (cats.length === 0) {
            cats = await repos.categoryRepo.seedDefaults(validatedUserId);
          }
          return cats;
        } catch {
          let cats = await fallbackCategoryRepo.findByUserId(validatedUserId);
          if (cats.length === 0) {
            cats = await fallbackCategoryRepo.seedDefaults(validatedUserId);
          }
          return cats;
        }
      },
      enabled: !!user?.id,
      staleTime: 5 * 60 * 1000,
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false
    },
    client
  );

  const incomeCategories = categories.filter((c) => c.type === 'income' && !c.isArchived);
  const expenseCategories = categories.filter((c) => c.type === 'expense' && !c.isArchived);
  const categoryMap = new Map<string, Category>(categories.map((c) => [c.id, c]));

  const getCategoryById = (id?: string | null): Category | undefined => {
    if (!id) return undefined;
    return categoryMap.get(id);
  };

  return {
    categories,
    incomeCategories,
    expenseCategories,
    categoryMap,
    getCategoryById,
    isLoading,
    isError,
    error,
    refetch
  };
}
