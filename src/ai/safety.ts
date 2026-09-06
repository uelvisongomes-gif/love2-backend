export type SafetyCategory =
  | 'violence'
  | 'suicide'
  | 'child_abuse'
  | 'substance_abuse'
  | 'safe';

export interface SafetyFinding {
  category: SafetyCategory;
  matched: string[];
  source: 'deterministic' | 'classifier';
}

const PATTERNS: Record<Exclude<SafetyCategory, 'safe'>, RegExp[]> = {
  violence: [
    /\b(me|nos)\s+(bateu|agrediu|espancou|estrangulou|empurrou)\b/,
    /\bme\s+bater\b/,
    /\bela\s+me\s+bateu\b/,
    /\bele\s+me\s+bateu\b/,
    /\bapanho\b/,
    /\bamea[çc]ou\s+me\s+matar\b/,
    /\bviol[êe]ncia\s+dom[ée]stica\b/,
  ],
  suicide: [
    /\bquero\s+me\s+matar\b/,
    /\bn[aã]o\s+quero\s+mais\s+viver\b/,
    /\bpensei\s+em\s+me\s+matar\b/,
    /\bsuic[ií]dio\b/,
    /\bacabar\s+com\s+minha\s+vida\b/,
  ],
  child_abuse: [
    /\b(bater|espancar|abusar)\s+(no|da|do)\s+(meu|minha|nosso|nossa)\s+(filho|filha|crian[çc]a)\b/,
    /\babuso\s+infantil\b/,
  ],
  substance_abuse: [
    /\bb[êe]bado\s+e\s+(me|nos)\s+(bateu|agrediu)\b/,
    /\busando\s+drogas\s+pesadas\b/,
  ],
};

export function screen(text: string): SafetyFinding {
  const lower = text.toLowerCase();
  for (const cat of Object.keys(PATTERNS) as (keyof typeof PATTERNS)[]) {
    const hits: string[] = [];
    for (const rx of PATTERNS[cat]) {
      const m = lower.match(rx);
      if (m) hits.push(m[0]);
    }
    if (hits.length > 0) return { category: cat, matched: hits, source: 'deterministic' };
  }
  return { category: 'safe', matched: [], source: 'deterministic' };
}

export async function assessMessage(
  text: string,
  classifier?: (text: string) => Promise<SafetyFinding>,
): Promise<SafetyFinding> {
  const det = screen(text);
  if (det.category !== 'safe') return det;
  if (classifier) return classifier(text);
  return det;
}

export const SAFETY_EMERGENCY_MESSAGE = [
  'Ouvi o que você compartilhou e estou preocupada com sua segurança.',
  '',
  'Isso está além do que eu, LOVE, posso mediar com responsabilidade. Por favor, procure ajuda especializada agora:',
  '',
  '• CVV — Centro de Valorização da Vida: 188 (ligação gratuita, 24h)',
  '• Ligue 180 — Central de Atendimento à Mulher (24h)',
  '• SAMU: 192',
  '• Polícia Militar: 190',
  '',
  'Se você estiver em perigo imediato, ligue 190 ou vá a um lugar seguro.',
  'Você não está sozinha(o).',
].join('\n');
