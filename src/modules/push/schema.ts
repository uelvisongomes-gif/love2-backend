import { z } from 'zod';

export const subscribeInput = z
  .object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    }),
    userAgent: z.string().max(500).optional(),
  })
  .strict();
export type SubscribeInputSchema = z.infer<typeof subscribeInput>;

export const unsubscribeInput = z
  .object({
    endpoint: z.string().url(),
  })
  .strict();
export type UnsubscribeInputSchema = z.infer<typeof unsubscribeInput>;
