export interface CreateAccountDTO {
  userId?: string;
  name: string;
  accountType?: 'cash' | 'bank' | 'savings' | 'credit_card' | 'wallet' | 'other';
  openingBalancePaise?: number;
  currency?: string;
  institutionName?: string;
  color?: string;
  icon?: string;

  // Compatibility fields
  type?: 'cash' | 'bank' | 'savings' | 'credit_card' | 'wallet' | 'other' | 'upi';
  openingBalanceInPaise?: number;
}

export interface UpdateAccountDTO {
  id: string;
  name?: string;
  accountType?: 'cash' | 'bank' | 'savings' | 'credit_card' | 'wallet' | 'other';
  institutionName?: string;
  color?: string;
  icon?: string;
  isArchived?: boolean;
}

export interface AccountResponseDTO {
  id: string;
  userId: string;
  name: string;
  accountType: string;
  openingBalancePaise: number;
  openingBalanceFormatted: string;
  currency: string;
  institutionName?: string;
  color?: string;
  icon?: string;
  isArchived: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AccountBalanceDTO {
  accountId: string;
  accountName: string;
  accountType: string;
  currency: string;
  openingBalancePaise: number;
  currentBalancePaise: number;
  currentBalanceFormatted: string;
  isCreditCard: boolean;
  isArchived: boolean;

  // Compatibility fields
  openingBalanceInPaise?: number;
  currentBalanceInPaise?: number;
}
