import { z } from 'zod';
import { PILLARS } from '../profile/schema.js';

const event = z.object({
  kind: z.enum(['good', 'bad']),
  pillar: z.enum(PILLARS),
  intensity: z.number().int().min(1).max(10),
  description: z.string().min(1).max(500),
});

export const checkinTodayInput = z
  .object({
    moodOverall: z.number().int().min(1).max(10),
    events: z.array(event).max(20).default([]),
    intimacyToday: z.boolean().default(false),
    dateNightToday: z.boolean().default(false),
  })
  .strict();
export type CheckinTodayInput = z.infer<typeof checkinTodayInput>;
