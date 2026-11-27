import { Lender } from '@/domain/entities/Lender';
import {
  createLenderId,
  validateUserId,
  isValidUuid
} from '@/domain/value-objects/Identifiers';
import { InvalidUserIdError } from '@/domain/errors/DomainErrors';
import { InvalidLenderNameError } from '@/domain/errors/BorrowingErrors';
import { LocalLenderRecord } from '@/infrastructure/database/local/schema';

export interface CloudLenderRow {
  id: string; // UUID
  user_id: string; // UUID
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  is_archived: boolean;
  created_at?: string;
  updated_at?: string;
}

export class LenderMapper {
  /**
   * Validates structural and ownership fields of a CloudLenderRow.
   */
  public static validateCloudRow(row: CloudLenderRow): void {
    if (!row || typeof row !== 'object') {
      throw new Error('Malformed cloud lender row: expected object.');
    }
    if (typeof row.id !== 'string' || !isValidUuid(row.id)) {
      throw new Error(`Invalid cloud lender ID '${row.id}': must be a valid UUID.`);
    }
    validateUserId(row.user_id);

    if (typeof row.name !== 'string' || row.name.trim().length === 0) {
      throw new InvalidLenderNameError(`Invalid cloud lender name on '${row.id}'.`);
    }
  }

  /**
   * Converts a CloudLenderRow to a LocalLenderRecord for Dexie persistence.
   */
  public static toLocalRecord(row: CloudLenderRow): LocalLenderRecord {
    this.validateCloudRow(row);
    const nowIso = new Date().toISOString();
    return {
      id: row.id.trim(),
      userId: validateUserId(row.user_id),
      name: row.name.trim(),
      phone: row.phone ?? undefined,
      email: row.email ?? undefined,
      notes: row.notes ?? undefined,
      isArchived: Boolean(row.is_archived),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : nowIso,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : nowIso
    };
  }

  /**
   * Converts a raw PostgreSQL cloud lender row to the domain Lender entity.
   */
  public static toDomain(row: CloudLenderRow): Lender {
    return new Lender({
      id: createLenderId(row.id),
      userId: validateUserId(row.user_id),
      name: row.name,
      phone: row.phone ?? undefined,
      email: row.email ?? undefined,
      notes: row.notes ?? undefined,
      isArchived: Boolean(row.is_archived),
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined
    });
  }

  /**
   * Converts a domain Lender entity to a complete CloudLenderRow.
   */
  public static toCloud(lender: Lender): CloudLenderRow {
    return {
      id: lender.id,
      user_id: lender.userId,
      name: lender.name,
      phone: lender.phone ?? null,
      email: lender.email ?? null,
      notes: lender.notes ?? null,
      is_archived: lender.isArchived,
      created_at: lender.createdAt.toISOString(),
      updated_at: lender.updatedAt.toISOString()
    };
  }

  /**
   * Maps an outbox INSERT payload to a complete CloudLenderRow.
   * Strictly validates UUIDs, non-empty name, and field boundaries.
   */
  public static mapCreatePayload(payload: Record<string, unknown>): CloudLenderRow {
    const id = payload.id;
    if (typeof id !== 'string' || !isValidUuid(id)) {
      throw new Error(`Invalid lender ID '${id}': must be a valid UUID.`);
    }

    const userId = payload.user_id ?? payload.userId;
    if (typeof userId !== 'string' || !isValidUuid(userId)) {
      throw new InvalidUserIdError(`Invalid user ID '${userId}': must be a valid UUID.`);
    }

    const name = payload.name;
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new InvalidLenderNameError('Lender name must not be empty.');
    }
    if (name.trim().length > 100) {
      throw new Error('Lender name exceeds maximum length of 100 characters.');
    }

    const phone =
      typeof payload.phone === 'string' && payload.phone.trim().length > 0
        ? payload.phone.trim()
        : null;

    const email =
      typeof payload.email === 'string' && payload.email.trim().length > 0
        ? payload.email.trim()
        : null;

    const notes =
      typeof payload.notes === 'string' && payload.notes.trim().length > 0
        ? payload.notes.trim()
        : null;

    const isArchived = Boolean(payload.is_archived ?? payload.isArchived);

    const createdAt =
      typeof payload.created_at === 'string'
        ? payload.created_at
        : typeof payload.createdAt === 'string'
          ? payload.createdAt
          : new Date().toISOString();

    const updatedAt =
      typeof payload.updated_at === 'string'
        ? payload.updated_at
        : typeof payload.updatedAt === 'string'
          ? payload.updatedAt
          : new Date().toISOString();

    return {
      id,
      user_id: userId,
      name: name.trim(),
      phone,
      email,
      notes,
      is_archived: isArchived,
      created_at: createdAt,
      updated_at: updatedAt
    };
  }

  /**
   * Maps an outbox UPDATE payload to a partial CloudLenderRow.
   * Strips immutable fields: id, user_id, created_at.
   */
  public static mapUpdatePayload(payload: Record<string, unknown>): Partial<CloudLenderRow> {
    const patch: Partial<CloudLenderRow> = {};

    if (payload.name !== undefined) {
      if (typeof payload.name !== 'string' || payload.name.trim().length === 0) {
        throw new InvalidLenderNameError('Lender name must not be empty.');
      }
      if (payload.name.trim().length > 100) {
        throw new Error('Lender name exceeds maximum length of 100 characters.');
      }
      patch.name = payload.name.trim();
    }

    if (payload.phone !== undefined) {
      patch.phone =
        typeof payload.phone === 'string' && payload.phone.trim().length > 0
          ? payload.phone.trim()
          : null;
    }

    if (payload.email !== undefined) {
      patch.email =
        typeof payload.email === 'string' && payload.email.trim().length > 0
          ? payload.email.trim()
          : null;
    }

    if (payload.notes !== undefined) {
      patch.notes =
        typeof payload.notes === 'string' && payload.notes.trim().length > 0
          ? payload.notes.trim()
          : null;
    }

    if (payload.is_archived !== undefined || payload.isArchived !== undefined) {
      patch.is_archived = Boolean(payload.is_archived ?? payload.isArchived);
    }

    patch.updated_at = new Date().toISOString();

    // Strip immutable fields
    delete (patch as Record<string, unknown>).id;
    delete (patch as Record<string, unknown>).user_id;
    delete (patch as Record<string, unknown>).created_at;

    return patch;
  }
}
