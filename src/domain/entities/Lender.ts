import { LenderId, UserId, isValidUuid } from '../value-objects/Identifiers';
import { InvalidUserIdError } from '../errors/DomainErrors';
import { InvalidLenderNameError } from '../errors/BorrowingErrors';
import { normalizeOptionalText } from '@/utils/textNormalization';

export interface LenderProps {
  id: LenderId;
  userId: UserId;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  isArchived?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Lender {
  public readonly id: LenderId;
  public readonly userId: UserId;
  public readonly name: string;
  public readonly phone?: string;
  public readonly email?: string;
  public readonly notes?: string;
  public readonly isArchived: boolean;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(props: LenderProps) {
    if (!props.name || props.name.trim().length === 0) {
      throw new InvalidLenderNameError();
    }

    if (!props.userId || !isValidUuid(props.userId)) {
      throw new InvalidUserIdError(
        typeof props.userId === 'string' && props.userId.trim().length > 0
          ? `Invalid user ID '${props.userId}'. A valid UUID is required.`
          : 'User ID is required and must be a valid UUID.'
      );
    }

    const now = new Date();
    this.id = props.id;
    this.userId = props.userId;
    this.name = props.name.trim();
    this.phone = normalizeOptionalText(props.phone);
    this.email = normalizeOptionalText(props.email);
    this.notes = normalizeOptionalText(props.notes);
    this.isArchived = props.isArchived ?? false;
    this.createdAt = props.createdAt ?? now;
    this.updatedAt = props.updatedAt ?? now;

    Object.freeze(this);
  }
}
