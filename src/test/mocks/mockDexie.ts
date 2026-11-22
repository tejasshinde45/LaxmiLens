import { vi } from 'vitest';

export const mockDexieTable = () => ({
  get: vi.fn(),
  put: vi.fn(),
  bulkPut: vi.fn(),
  delete: vi.fn(),
  clear: vi.fn(),
  count: vi.fn().mockResolvedValue(0),
  toArray: vi.fn().mockResolvedValue([]),
  where: vi.fn().mockReturnValue({
    equals: vi.fn().mockReturnValue({
      first: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      toArray: vi.fn().mockResolvedValue([]),
      or: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([])
        })
      })
    }),
    between: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([])
      }),
      toArray: vi.fn().mockResolvedValue([])
    })
  }),
  toCollection: vi.fn().mockReturnValue({
    toArray: vi.fn().mockResolvedValue([])
  }),
  orderBy: vi.fn().mockReturnValue({
    limit: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([])
    })
  })
});
