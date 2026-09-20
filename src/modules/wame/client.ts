import { Wame } from '@raphaelvserafim/client-api-whatsapp';
import { loadConfig } from '../../config.js';

let cached: Wame | null = null;

/**
 * Cliente WAME lazily inicializado. Retorna null se WAME_ENABLED=false
 * ou se faltar credenciais — permite que o app suba sem WhatsApp.
 */
export function getWame(): Wame | null {
  if (cached) return cached;
  const cfg = loadConfig();
  if (!cfg.WAME_ENABLED) return null;
  if (!cfg.WAME_API_KEY) return null;
  cached = new Wame({ server: cfg.WAME_SERVER, key: cfg.WAME_API_KEY });
  return cached;
}

export function requireWame(): Wame {
  const w = getWame();
  if (!w) throw new Error('WAME não configurado — defina WAME_ENABLED e WAME_API_KEY');
  return w;
}
