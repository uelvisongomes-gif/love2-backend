import { z } from 'zod';

export const inviteInput = z.object({ inviteeEmail: z.string().email().toLowerCase() }).strict();
export const acceptInput = z.object({ code: z.string().regex(/^[A-Z0-9]{8}$/) }).strict();
export type InviteInput = z.infer<typeof inviteInput>;
export type AcceptInput = z.infer<typeof acceptInput>;
