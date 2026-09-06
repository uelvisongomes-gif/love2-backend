import { z } from 'zod';

export const consentScopes = ['terms', 'privacy', 'disclaimer_love_not_therapist'] as const;
export type ConsentScope = (typeof consentScopes)[number];

export const consentInput = z
  .object({
    scope: z.enum(consentScopes),
    version: z.string().min(1),
  })
  .strict();
export type ConsentInput = z.infer<typeof consentInput>;
