export interface CreateCategoryDTO {
  userId: string;
  name: string;
  type: 'income' | 'expense';
  icon?: string;
  color?: string;
  isDefault?: boolean;
}

export interface UpdateCategoryDTO {
  id: string;
  userId: string;
  name?: string;
  icon?: string;
  color?: string;
  isArchived?: boolean;
}

export interface CategoryResponseDTO {
  id: string;
  userId: string;
  name: string;
  type: 'income' | 'expense';
  icon?: string;
  color?: string;
  isDefault: boolean;
  isArchived: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}
