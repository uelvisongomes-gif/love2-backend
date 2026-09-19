import { z } from 'zod';

export const CARE_PREFERENCES = [
  'mais_carinho',
  'mais_espaco',
  'paciencia_com_sensibilidade',
  'ajuda_nas_tarefas',
  'evitar_conversas_dificeis',
  'perguntar_como_estou',
  'lembrar_de_comprar_o_que_preciso',
] as const;

export const updateProfileInput = z
  .object({
    averageCycleDays: z.number().int().min(20).max(45).optional(),
    averagePeriodDays: z.number().int().min(1).max(15).optional(),
    premenstrualDays: z.number().int().min(0).max(15).optional(),
    shareWithPartner: z.boolean().optional(),
    sharePeriodStart: z.boolean().optional(),
    sharePreMenstrual: z.boolean().optional(),
    sharePreferences: z.boolean().optional(),
    carePreferences: z.array(z.enum(CARE_PREFERENCES)).optional(),
    customNote: z.string().max(1000).optional().nullable(),
  })
  .strict();
export type UpdateProfileInput = z.infer<typeof updateProfileInput>;

export const logPeriodInput = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();
export type LogPeriodInput = z.infer<typeof logPeriodInput>;

export const symptomsSchema = z
  .object({
    mood: z.enum(['bem', 'ok', 'irritada', 'triste', 'ansiosa']).optional(),
    cramp: z.boolean().optional(),
    headache: z.boolean().optional(),
    fatigue: z.boolean().optional(),
    bloating: z.boolean().optional(),
    sensitivity: z.boolean().optional(),
    wantSpace: z.boolean().optional(),
    wantAffection: z.boolean().optional(),
  })
  .strict()
  .partial();

export const dailyLogInput = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    symptoms: symptomsSchema,
    note: z.string().max(1000).optional(),
  })
  .strict();
export type DailyLogInput = z.infer<typeof dailyLogInput>;
