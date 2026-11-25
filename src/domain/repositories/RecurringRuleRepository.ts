import { RecurringRule, RecurringRuleStatus } from '../entities/RecurringRule';
import { RecurringRuleId, UserId } from '../value-objects/Identifiers';

export interface RecurringRuleRepository {
  findById(id: RecurringRuleId, userId: UserId): Promise<RecurringRule | null>;
  findAll(userId: UserId): Promise<RecurringRule[]>;
  findByStatus(status: RecurringRuleStatus, userId: UserId): Promise<RecurringRule[]>;
  save(rule: RecurringRule): Promise<void>;
  delete(id: RecurringRuleId, userId: UserId): Promise<void>;
}
