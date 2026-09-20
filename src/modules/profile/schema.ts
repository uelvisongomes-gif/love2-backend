import { z } from 'zod';

export const LOVE_LANGUAGES = [
  'palavras_afirmacao',
  'tempo_qualidade',
  'presentes',
  'atos_servico',
  'toque_fisico',
] as const;

export const PILLARS = [
  'financeiro',
  'comunicacao',
  'intimidade',
  'filhos',
  'tarefas',
  'papeis',
  'espiritualidade',
] as const;

const pillarScore = z.number().min(0).max(10);
const pillarScores = z.object({
  financeiro: pillarScore,
  comunicacao: pillarScore,
  intimidade: pillarScore,
  filhos: pillarScore,
  tarefas: pillarScore,
  papeis: pillarScore,
  espiritualidade: pillarScore,
});

const loveLanguagesRanking = z
  .array(z.enum(LOVE_LANGUAGES))
  .length(5)
  .refine((arr) => new Set(arr).size === 5, {
    message: 'love languages ranking must contain each of the 5 values exactly once',
  });

const preferences = z.object({
  religion: z.string().max(40).nullable(),
  religionOptIn: z.boolean(),
  politicsOptIn: z.boolean(),
  avoidedTopics: z.array(z.enum(PILLARS)).default([]),
});

export const upsertProfileInput = z
  .object({
    loveLanguagesRanking: loveLanguagesRanking.optional(),
    pillarScores: pillarScores.optional(),
    preferences: preferences.optional(),
    relationshipYears: z.number().int().min(0).max(80).optional(),
    hasChildren: z.boolean().optional(),
    livingTogether: z.boolean().optional(),
    timezone: z.string().optional(),
    // Etapa 2 — dados pessoais expandidos
    birthDate: z.string().datetime().nullable().optional(),
    gender: z.enum(['mulher', 'homem', 'naobinario', 'prefiro_nao_dizer']).nullable().optional(),
    occupation: z.string().max(120).nullable().optional(),
    location: z.string().max(120).nullable().optional(),
    healthNotes: z.string().max(2000).nullable().optional(),
    civilStatus: z.enum(['namoro', 'noivado', 'casados', 'uniao_estavel']).nullable().optional(),
    relationshipStart: z.string().datetime().nullable().optional(),
    howMet: z.string().max(500).nullable().optional(),
  })
  .strict();
export type UpsertProfileInput = z.infer<typeof upsertProfileInput>;

// Foto do usuário (data URL) — cliente comprime pra ~15-30KB
export const uploadPhotoInput = z
  .object({
    photoUrl: z
      .string()
      .max(200_000) // ~150KB base64 hard cap
      .regex(/^data:image\/(jpeg|png|webp);base64,/, 'formato inválido — use imagem'),
  })
  .strict();
export type UploadPhotoInput = z.infer<typeof uploadPhotoInput>;
