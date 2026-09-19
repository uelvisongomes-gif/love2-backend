import { z } from 'zod';

export const FINANCE_KINDS = ['conta_mensal', 'compra_grande', 'decisao'] as const;
export type FinanceKind = (typeof FINANCE_KINDS)[number];

export const FINANCE_CATEGORIES = [
  'moradia',
  'alimentacao',
  'transporte',
  'saude',
  'lazer',
  'educacao',
  'outros',
] as const;
export type FinanceCategory = (typeof FINANCE_CATEGORIES)[number];

export const createFinanceInput = z
  .object({
    kind: z.enum(FINANCE_KINDS),
    title: z.string().min(1).max(200),
    amount: z.number().nonnegative().optional(),
    category: z.enum(FINANCE_CATEGORIES).optional(),
    dueBy: z.string().datetime().optional(),
    assignTo: z.enum(['me', 'partner', 'both']).default('both'),
    recurring: z.boolean().default(false),
    notes: z.string().max(2000).optional(),
  })
  .strict();
export type CreateFinanceInput = z.infer<typeof createFinanceInput>;

export const updateFinanceInput = z
  .object({
    title: z.string().min(1).max(200).optional(),
    amount: z.number().nonnegative().optional().nullable(),
    category: z.enum(FINANCE_CATEGORIES).optional().nullable(),
    dueBy: z.string().datetime().optional().nullable(),
    assignTo: z.enum(['me', 'partner', 'both']).optional(),
    recurring: z.boolean().optional(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .strict();
export type UpdateFinanceInput = z.infer<typeof updateFinanceInput>;

export const listFinanceQuery = z
  .object({
    kind: z.enum(FINANCE_KINDS).optional(),
    status: z.enum(['open', 'paid', 'all']).default('all'),
  })
  .strict();
export type ListFinanceQuery = z.infer<typeof listFinanceQuery>;
