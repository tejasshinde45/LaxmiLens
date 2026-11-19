export type Brand<K, T> = K & { readonly __brand: T };

export type UUID = Brand<string, 'UUID'>;
export type ISODateString = Brand<string, 'ISODateString'>;

export type Result<T, E = Error> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: E };

export const Result = {
  ok: <T>(data: T): Result<T, never> => ({ success: true, data }),
  fail: <E>(error: E): Result<never, E> => ({ success: false, error })
};

export type SyncStatus = 'synced' | 'pending' | 'failed' | 'conflict';
