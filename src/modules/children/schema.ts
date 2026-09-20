import { z } from 'zod';

const GENDER = ['menino', 'menina', 'outro'] as const;
const PARENTAGE = ['biologico_ambos', 'biologico_um', 'adotado', 'enteado'] as const;
const LIVES_WITH = ['conosco', 'pai', 'mae', 'alternado'] as const;

export const createChildInput = z
  .object({
    name: z.string().min(1).max(80),
    birthDate: z.string().datetime().nullable().optional(),
    gender: z.enum(GENDER).nullable().optional(),
    photoUrl: z
      .string()
      .max(200_000)
      .regex(/^data:image\/(jpeg|png|webp);base64,/)
      .nullable()
      .optional(),
    parentage: z.enum(PARENTAGE).nullable().optional(),
    livesWith: z.enum(LIVES_WITH).nullable().optional(),
    schoolInfo: z.string().max(500).nullable().optional(),
    healthNotes: z.string().max(2000).nullable().optional(),
    personality: z.string().max(1000).nullable().optional(),
  })
  .strict();
export type CreateChildInput = z.infer<typeof createChildInput>;

export const updateChildInput = createChildInput.partial();
export type UpdateChildInput = z.infer<typeof updateChildInput>;
