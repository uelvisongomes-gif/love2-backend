import { z } from 'zod';

export const LIFE_DOMAINS = ['filhos', 'metas', 'tempo_casal'] as const;
export type LifeDomain = (typeof LIFE_DOMAINS)[number];

export const createLifeInput = z
  .object({
    domain: z.enum(LIFE_DOMAINS),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    scheduledAt: z.string().datetime().optional(),
    assignTo: z.enum(['me', 'partner', 'both']).default('both'),
    recurring: z.boolean().default(false),
  })
  .strict();
export type CreateLifeInput = z.infer<typeof createLifeInput>;

export const updateLifeInput = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional().nullable(),
    scheduledAt: z.string().datetime().optional().nullable(),
    assignTo: z.enum(['me', 'partner', 'both']).optional(),
    recurring: z.boolean().optional(),
  })
  .strict();
export type UpdateLifeInput = z.infer<typeof updateLifeInput>;

export const listLifeQuery = z
  .object({
    domain: z.enum(LIFE_DOMAINS),
    status: z.enum(['open', 'done', 'all']).default('all'),
  })
  .strict();
export type ListLifeQuery = z.infer<typeof listLifeQuery>;
