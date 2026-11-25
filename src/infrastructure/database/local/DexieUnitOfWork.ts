import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { db, LaxmiLensDB } from './DexieDatabase';
import { Table } from 'dexie';

export class DexieUnitOfWork implements UnitOfWork {
  private readonly tables: Table<any, any>[];

  constructor(
    private readonly database: LaxmiLensDB = db,
    tables?: Table<any, any>[]
  ) {
    if (tables) {
      this.tables = tables;
    } else {
      const candidates = [
        this.database.accounts,
        this.database.transactions,
        this.database.categories,
        this.database.budgets,
        this.database.recurringRules,
        this.database.recurringOccurrences,
        this.database.notifications,
        this.database.notificationPreferences,
        this.database.lenders,
        this.database.borrowings,
        this.database.borrowingRepayments,
        this.database.syncOutbox
      ];
      this.tables = candidates.filter((t): t is Table<any, any> => Boolean(t));
    }
  }

  public async run<T>(work: () => Promise<T>): Promise<T> {
    return this.database.transaction('rw', this.tables, async () => {
      return await work();
    });
  }
}
