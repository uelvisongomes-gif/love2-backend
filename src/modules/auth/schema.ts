import { z } from 'zod';

export const registerInput = z
  .object({
    name: z.string().min(2).max(80),
    email: z.string().email().toLowerCase(),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/, 'phone must be E.164'),
    password: z
      .string()
      .min(6, 'senha precisa ter no mínimo 6 caracteres')
      .regex(/[A-Z]/, 'precisa ter ao menos uma letra maiúscula')
      .regex(/[a-z]/, 'precisa ter ao menos uma letra minúscula')
      .regex(/\d/, 'precisa ter ao menos um número'),
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

export const verify2faInput = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
export type Verify2faInput = z.infer<typeof verify2faInput>;
