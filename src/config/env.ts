import { z } from 'zod';

const envSchema = z.object({
  VITE_SUPABASE_URL: z.string().url('VITE_SUPABASE_URL must be a valid URL'),
  VITE_SUPABASE_ANON_KEY: z.string().min(1, 'VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY is required').optional(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  VITE_APP_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  VITE_ENABLE_MOCK_SYNC: z
    .string()
    .optional()
    .transform((val) => val === 'true')
}).refine(
  (data) => !!data.VITE_SUPABASE_ANON_KEY || !!data.VITE_SUPABASE_PUBLISHABLE_KEY,
  {
    message: 'Either VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY must be provided',
    path: ['VITE_SUPABASE_ANON_KEY']
  }
);

const parseEnv = () => {
  const result = envSchema.safeParse(import.meta.env);

  if (!result.success) {
    const formattedErrors = result.error.format();
    console.error('❌ Environment configuration error:', JSON.stringify(formattedErrors, null, 2));
    throw new Error('Invalid environment variables. Please check your .env file against .env.example.');
  }

  const raw = result.data;
  const anonKey = (raw.VITE_SUPABASE_ANON_KEY || raw.VITE_SUPABASE_PUBLISHABLE_KEY) as string;

  return {
    ...raw,
    VITE_SUPABASE_ANON_KEY: anonKey,
    VITE_SUPABASE_PUBLISHABLE_KEY: anonKey
  };
};

export const env = parseEnv();
export type Env = ReturnType<typeof parseEnv>;
