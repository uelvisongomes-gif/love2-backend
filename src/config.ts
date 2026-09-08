import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  ACCESS_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
  SMS_DRIVER: z.enum(['twilio', 'memory']).default('memory'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  LLM_PROVIDER: z.enum(['anthropic', 'memory']).default('memory'),
  LLM_MODEL: z.string().default('claude-opus-5'),
  LLM_MODEL_LIGHT: z.string().default('claude-haiku-4-5'),
  ANTHROPIC_API_KEY: z.string().optional(),
  EMBEDDING_PROVIDER: z.enum(['voyage', 'openai', 'memory']).default('memory'),
  EMBEDDING_MODEL: z.string().default('voyage-3'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1024),
  VOYAGE_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  EMAIL_DRIVER: z.enum(['smtp', 'brevo', 'memory']).default('memory'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  BREVO_API_KEY: z.string().optional(),
  APP_URL: z.string().url().default('https://love2-woad.vercel.app'),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return schema.parse(env);
}
