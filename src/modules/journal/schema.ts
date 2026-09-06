import { z } from 'zod';

export const createEntryInput = z
  .object({
    title: z.string().min(1).max(120),
    content: z.string().min(1).max(20000),
    mood: z.number().int().min(1).max(10).optional(),
  })
  .strict();
export type CreateEntryInput = z.infer<typeof createEntryInput>;

export const updateEntryInput = createEntryInput.partial().strict();
export type UpdateEntryInput = z.infer<typeof updateEntryInput>;

export const listQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().optional(),
  })
  .strict();
