import { z } from 'zod';

const envSchema = z.object({
  VITE_SUPABASE_URL: z.string().url('VITE_SUPABASE_URL must be a valid URL'),
  VITE_SUPABASE_ANON_KEY: z.string().min(1, 'VITE_SUPABASE_ANON_KEY is required'),
  VITE_APP_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  VITE_ENABLE_MOCK_SYNC: z
    .string()
    .optional()
    .transform((val) => val === 'true')
});

const parseEnv = () => {
  const result = envSchema.safeParse(import.meta.env);

  if (!result.success) {
    const formattedErrors = result.error.format();
    console.error('❌ Environment configuration error:', JSON.stringify(formattedErrors, null, 2));
    throw new Error('Invalid environment variables. Please check your .env file against .env.example.');
  }

  return result.data;
};

export const env = parseEnv();
export type Env = z.infer<typeof envSchema>;
