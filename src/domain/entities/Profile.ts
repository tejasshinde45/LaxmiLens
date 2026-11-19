import { UserId } from '../value-objects/Identifiers';

export interface ProfileProps {
  id: UserId;
  email: string;
  displayName?: string;
  currency?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Profile {
  public readonly id: UserId;
  public readonly email: string;
  public readonly displayName?: string;
  public readonly currency: string;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(props: ProfileProps) {
    if (!props.email || !props.email.includes('@')) {
      throw new Error('Valid email address is required for user profile.');
    }

    const now = new Date();
    this.id = props.id;
    this.email = props.email.toLowerCase().trim();
    this.displayName = props.displayName?.trim();
    this.currency = props.currency ?? 'INR';
    this.createdAt = props.createdAt ?? now;
    this.updatedAt = props.updatedAt ?? now;
    Object.freeze(this);
  }
}
