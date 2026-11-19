import { StoragePort } from '@/application/ports/StoragePort';

export class LocalStorageAdapter implements StoragePort {
  public async getItem<T>(key: string): Promise<T | null> {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  public async setItem<T>(key: string, value: T): Promise<void> {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.error('LocalStorage write failed:', err);
    }
  }

  public async removeItem(key: string): Promise<void> {
    localStorage.removeItem(key);
  }

  public async clear(): Promise<void> {
    localStorage.clear();
  }
}
