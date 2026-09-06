import { z } from 'zod';

export const chatInput = z
  .object({
    content: z.string().min(1).max(4000),
    context: z.enum(['general', 'check-in', 'conflict', 'journal']),
  })
  .strict();
export type ChatEndpointInput = z.infer<typeof chatInput>;
