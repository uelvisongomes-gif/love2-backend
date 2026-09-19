import { z } from 'zod';
import { PILLARS } from '../profile/schema.js';

export const createAgreementInput = z
  .object({
    title: z.string().min(1).max(200),
    content: z.string().min(1).max(4000),
    pillar: z.enum(PILLARS).optional(),
    conflictId: z.string().optional(),
  })
  .strict();
export type CreateAgreementInput = z.infer<typeof createAgreementInput>;

export const updateAgreementInput = z
  .object({
    title: z.string().min(1).max(200).optional(),
    content: z.string().min(1).max(4000).optional(),
    pillar: z.enum(PILLARS).optional(),
  })
  .strict();
export type UpdateAgreementInput = z.infer<typeof updateAgreementInput>;

export const agreementStatusValues = ['em_andamento', 'cumprido', 'precisa_revisar'] as const;
export type AgreementStatus = (typeof agreementStatusValues)[number];

export const setStatusInput = z
  .object({
    status: z.enum(agreementStatusValues),
  })
  .strict();
export type SetStatusInput = z.infer<typeof setStatusInput>;
