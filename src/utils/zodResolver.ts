import { z } from 'zod';

/**
 * Custom Zod resolver for React Hook Form.
 * Works seamlessly with Zod schemas including refinements and transformations,
 * without requiring the @hookform/resolvers package.
 */
export function zodResolver<T extends z.ZodTypeAny>(schema: T) {
  return async (values: unknown) => {
    const result = await schema.safeParseAsync(values);

    if (result.success) {
      return {
        values: result.data,
        errors: {}
      };
    }

    const errors: Record<string, { type: string; message: string }> = {};

    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      if (!errors[path]) {
        errors[path] = {
          type: issue.code,
          message: issue.message
        };
      }
    }

    return {
      values: {},
      errors
    };
  };
}
