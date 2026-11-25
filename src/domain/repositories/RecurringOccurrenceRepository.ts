import {
  RecurringOccurrence,
  RecurringOccurrenceStatus
} from '../entities/RecurringOccurrence';
import {
  RecurringOccurrenceId,
  RecurringRuleId,
  UserId
} from '../value-objects/Identifiers';

export interface RecurringOccurrenceRepository {
  findById(id: RecurringOccurrenceId, userId: UserId): Promise<RecurringOccurrence | null>;
  findByRuleAndDate(
    recurringRuleId: RecurringRuleId,
    occurrenceDate: string,
    userId: UserId
  ): Promise<RecurringOccurrence | null>;
  findByRuleId(recurringRuleId: RecurringRuleId, userId: UserId): Promise<RecurringOccurrence[]>;
  findByStatus(
    status: RecurringOccurrenceStatus,
    userId: UserId
  ): Promise<RecurringOccurrence[]>;
  findAll(userId: UserId): Promise<RecurringOccurrence[]>;
  save(occurrence: RecurringOccurrence): Promise<void>;
}
