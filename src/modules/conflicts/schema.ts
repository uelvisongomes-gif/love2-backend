import { z } from 'zod';
import { PILLARS } from '../profile/schema.js';

export const CONFLICT_STATUS = [
  'collecting_a',
  'blocks_pending',
  'ponte_invited',
  'ponte_accepted',
  'ponte_declined',
  'collecting_b',
  'cross_referenced',
  'closed',
] as const;
export type ConflictStatus = (typeof CONFLICT_STATUS)[number];

export const createConflictInput = z
  .object({
    initialContent: z.string().min(1).max(4000),
    pillar: z.enum(PILLARS).optional(),
    title: z.string().max(120).optional(),
  })
  .strict();
export type CreateConflictInput = z.infer<typeof createConflictInput>;

export const conflictMessageInput = z
  .object({ content: z.string().min(1).max(4000) })
  .strict();
export type ConflictMessageInput = z.infer<typeof conflictMessageInput>;
