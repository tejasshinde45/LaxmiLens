export interface CreateAccountDTO {
  name: string;
  type: 'cash' | 'bank' | 'upi' | 'wallet' | 'credit_card';
  currency?: string;
  openingBalanceInPaise: number;
  color?: string;
  icon?: string;
}

export interface AccountBalanceDTO {
  accountId: string;
  accountName: string;
  accountType: string;
  currency: string;
  openingBalanceInPaise: number;
  currentBalanceInPaise: number;
  currentBalanceFormatted: string;
  isCreditCard: boolean;
}
