export const DEFAULT_CLOUD_PAGE_SIZE = 500;
const MAX_CLOUD_PAGES = 10_000;

export interface CloudPageQueryResult<TRow> {
  data: TRow[] | null;
  error: { message: string; code?: string } | null;
}

export interface RangeCapableQuery<TRow> {
  range: (from: number, to: number) => PromiseLike<CloudPageQueryResult<TRow>>;
}

export function hasRangeMethod<_TRow = unknown>(query: unknown): boolean {
  return (
    Boolean(query) &&
    typeof query === 'object' &&
    typeof (query as { range?: unknown }).range === 'function'
  );
}

/**
 * Fetches all pages sequentially using `.range(from, to)` over a deterministically
 * ordered query, preventing PostgREST's 1000-row cap from silently truncating results.
 */
export async function fetchAllOrderedPages<TRow extends { id: string }>(
  buildBaseQuery: () => RangeCapableQuery<TRow>,
  pageSize: number = DEFAULT_CLOUD_PAGE_SIZE,
  mapError: (error: { message: string; code?: string }) => Error
): Promise<TRow[]> {
  const safePageSize = Math.max(1, Math.min(1000, Math.floor(pageSize)));
  const collected: TRow[] = [];
  const seenIds = new Set<string>();
  let offset = 0;

  for (let page = 0; page < MAX_CLOUD_PAGES; page++) {
    // Request pageSize + 1 rows so exact-multiple boundaries require no extra round-trip
    const { data, error } = await buildBaseQuery().range(offset, offset + safePageSize);
    if (error) {
      throw mapError(error);
    }

    const batch = (data ?? []) as TRow[];
    const hasMore = batch.length > safePageSize;
    const pageRows = hasMore ? batch.slice(0, safePageSize) : batch;

    for (const row of pageRows) {
      if (!seenIds.has(row.id)) {
        seenIds.add(row.id);
        collected.push(row);
      }
    }

    if (!hasMore || pageRows.length < safePageSize) {
      break;
    }

    offset += pageRows.length;
  }

  return collected;
}
