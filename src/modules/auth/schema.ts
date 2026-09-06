import { z } from 'zod';

export const registerInput = z
  .object({
    name: z.string().min(2).max(80),
    email: z.string().email().toLowerCase(),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/, 'phone must be E.164'),
    password: z
      .string()
      .min(10)
      .regex(/[A-Z]/, 'must contain uppercase')
      .regex(/[a-z]/, 'must contain lowercase')
      .regex(/\d/, 'must contain digit'),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerInput>;

export const loginInput = z
  .object({
    email: z.string().email().toLowerCase(),
    password: z.string().min(1),
  })
  .strict();
export type LoginInput = z.infer<typeof loginInput>;
