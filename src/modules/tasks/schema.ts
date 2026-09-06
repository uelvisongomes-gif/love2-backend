import { z } from 'zod';
import { PILLARS } from '../profile/schema.js';

export const createTaskInput = z
  .object({
    pillar: z.enum(PILLARS),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    dueBy: z.string().datetime().optional(),
  })
  .strict();
export type CreateTaskInput = z.infer<typeof createTaskInput>;
