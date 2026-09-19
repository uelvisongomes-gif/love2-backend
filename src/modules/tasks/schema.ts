import { z } from 'zod';
import { PILLARS } from '../profile/schema.js';

export const TASK_CATEGORIES = ['casa', 'filhos', 'financas', 'tempo_casal', 'metas'] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const TASK_RECURRENCES = ['daily', 'weekly', 'monthly'] as const;
export type TaskRecurrence = (typeof TASK_RECURRENCES)[number];

export const createTaskInput = z
  .object({
    pillar: z.enum(PILLARS),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    dueBy: z.string().datetime().optional(),
    category: z.enum(TASK_CATEGORIES).optional(),
    // 'me' | 'partner' | 'both' — o service resolve pra userId real
    assignTo: z.enum(['me', 'partner', 'both']).default('both'),
    recurrence: z.enum(TASK_RECURRENCES).optional(),
    remindAt: z.string().datetime().optional(),
  })
  .strict();
export type CreateTaskInput = z.infer<typeof createTaskInput>;

export const listTasksQuery = z
  .object({
    category: z.enum(TASK_CATEGORIES).optional(),
    scope: z.enum(['all', 'mine', 'partner']).default('all'),
    status: z.enum(['open', 'done', 'all']).default('open'),
  })
  .strict();
export type ListTasksQuery = z.infer<typeof listTasksQuery>;
