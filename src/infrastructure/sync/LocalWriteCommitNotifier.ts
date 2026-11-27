import Dexie from 'dexie';

export type LocalWriteCommitListener = () => void;

interface DexieTransactionLike {
  on?: (event: string, listener: () => void) => void;
}

/**
 * Coordinates post-commit notifications across DexieUnitOfWork and OutboxManager.
 * Guarantees notifications fire strictly AFTER a transaction has committed on disk
 * (never inside an active IndexedDB transaction and never after rollback/abort).
 */
export class LocalWriteCommitNotifier {
  private readonly listeners = new Set<LocalWriteCommitListener>();
  private readonly attachedTxSet = new WeakSet<object>();
  private activeUowDepth = 0;
  private pendingOutboxWritesInUow = 0;

  public subscribe(listener: LocalWriteCommitListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Executes a UnitOfWork scope and notifies listeners strictly after the outer
   * UnitOfWork transaction commits with at least one persisted outbox write.
   */
  public async runInUowScope<T>(work: () => Promise<T>): Promise<T> {
    const isOutermostUow = this.activeUowDepth === 0;
    if (isOutermostUow) {
      this.pendingOutboxWritesInUow = 0;
    }

    this.activeUowDepth++;
    let result!: T;
    let committedWrites = 0;

    try {
      result = await work();
      if (isOutermostUow) {
        committedWrites = this.pendingOutboxWritesInUow;
      }
    } catch (err) {
      if (isOutermostUow) {
        this.pendingOutboxWritesInUow = 0;
      }
      throw err;
    } finally {
      this.activeUowDepth--;
      if (isOutermostUow) {
        this.pendingOutboxWritesInUow = 0;
      }
    }

    if (isOutermostUow && committedWrites > 0) {
      this.scheduleIfOutermostTransactionCompleted();
    }

    return result;
  }

  /**
   * Records that an outbox entry was written in the current context.
   * Inside UnitOfWork: deferred until UnitOfWork resolves and transaction commits.
   * Outside UnitOfWork: deferred via Dexie.currentTransaction.on('complete') when active,
   * or emitted immediately after standalone outbox persistence.
   */
  public recordOutboxWrite(): void {
    if (this.activeUowDepth > 0) {
      this.pendingOutboxWritesInUow++;
      return;
    }

    this.scheduleIfOutermostTransactionCompleted();
  }

  private scheduleIfOutermostTransactionCompleted(): void {
    const currentTx = (
      Dexie as unknown as { currentTransaction?: DexieTransactionLike | null }
    ).currentTransaction;

    if (currentTx && typeof currentTx === 'object' && typeof currentTx.on === 'function') {
      if (this.attachedTxSet.has(currentTx)) {
        return;
      }
      this.attachedTxSet.add(currentTx);
      currentTx.on('complete', () => {
        this.emit();
      });
      return;
    }

    this.emit();
  }

  private emit(): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener();
      } catch (err) {
        console.error('LocalWriteCommitNotifier listener failed:', err);
      }
    }
  }
}
