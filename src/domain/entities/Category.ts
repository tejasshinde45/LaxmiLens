import { CategoryId, UserId } from '../value-objects/Identifiers';

export type CategoryType = 'income' | 'expense';

export interface CategoryProps {
  id: CategoryId;
  userId: UserId;
  name: string;
  type: CategoryType;
  icon?: string;
  color?: string;
  isDefault?: boolean;
  isArchived?: boolean;
  version?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Category {
  public readonly id: CategoryId;
  public readonly userId: UserId;
  public readonly name: string;
  public readonly type: CategoryType;
  public readonly icon?: string;
  public readonly color?: string;
  public readonly isDefault: boolean;
  public readonly isArchived: boolean;
  public readonly version: number;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(props: CategoryProps) {
    if (!props.name || props.name.trim().length === 0) {
      throw new Error('Category name must not be empty.');
    }

    const now = new Date();
    this.id = props.id;
    this.userId = props.userId;
    this.name = props.name.trim();
    this.type = props.type;
    this.icon = props.icon;
    this.color = props.color;
    this.isDefault = props.isDefault ?? false;
    this.isArchived = props.isArchived ?? false;
    this.version = props.version ?? 1;
    this.createdAt = props.createdAt ?? now;
    this.updatedAt = props.updatedAt ?? now;
    Object.freeze(this);
  }

  public isIncome(): boolean {
    return this.type === 'income';
  }

  public isExpense(): boolean {
    return this.type === 'expense';
  }
}

/**
 * Standard sensible default category seed templates for Indian personal finance.
 */
export const DEFAULT_CATEGORY_SEEDS: readonly {
  name: string;
  type: CategoryType;
  icon: string;
  color: string;
}[] = [
  // Income Categories
  { name: 'Salary & Wages', type: 'income', icon: 'Briefcase', color: '#72B895' },
  { name: 'Business Income', type: 'income', icon: 'Building2', color: '#72B895' },
  { name: 'Investments & Dividends', type: 'income', icon: 'TrendingUp', color: '#72B895' },
  { name: 'Freelance & Consulting', type: 'income', icon: 'Laptop', color: '#72B895' },
  { name: 'Gifts & Grants', type: 'income', icon: 'Gift', color: '#72B895' },
  { name: 'Other Income', type: 'income', icon: 'PlusCircle', color: '#72B895' },

  // Expense Categories
  { name: 'Groceries & Household', type: 'expense', icon: 'ShoppingCart', color: '#D9827C' },
  { name: 'Food & Dining Out', type: 'expense', icon: 'Utensils', color: '#D9827C' },
  { name: 'Rent & Housing', type: 'expense', icon: 'Home', color: '#D9827C' },
  { name: 'Utilities & Bills', type: 'expense', icon: 'Zap', color: '#D9827C' },
  { name: 'Transport & Fuel', type: 'expense', icon: 'Car', color: '#D9827C' },
  { name: 'Health & Medical', type: 'expense', icon: 'Activity', color: '#D9827C' },
  { name: 'Shopping & Apparel', type: 'expense', icon: 'ShoppingBag', color: '#D9827C' },
  { name: 'Entertainment & Leisure', type: 'expense', icon: 'Film', color: '#D9827C' },
  { name: 'Education & Courses', type: 'expense', icon: 'BookOpen', color: '#D9827C' },
  { name: 'Personal Care', type: 'expense', icon: 'Smile', color: '#D9827C' },
  { name: 'Other Expense', type: 'expense', icon: 'MinusCircle', color: '#D9827C' }
] as const;
