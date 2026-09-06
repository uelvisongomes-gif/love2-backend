import twilio from 'twilio';
import { loadConfig } from '../../config.js';

export interface SmsSender {
  send(to: string, body: string): Promise<void>;
}

export class MemorySmsSender implements SmsSender {
  public sent: { to: string; body: string }[] = [];
  async send(to: string, body: string): Promise<void> {
    this.sent.push({ to, body });
  }
}

class TwilioSmsSender implements SmsSender {
  private client: ReturnType<typeof twilio>;
  private from: string;
  constructor(sid: string, token: string, from: string) {
    this.client = twilio(sid, token);
    this.from = from;
  }
  async send(to: string, body: string): Promise<void> {
    await this.client.messages.create({ to, from: this.from, body });
  }
}

let instance: SmsSender | null = null;

export function setSmsSender(sender: SmsSender): void {
  instance = sender;
}

export function getSmsSender(): SmsSender {
  if (instance) return instance;
  const cfg = loadConfig();
  if (cfg.SMS_DRIVER === 'twilio') {
    if (!cfg.TWILIO_ACCOUNT_SID || !cfg.TWILIO_AUTH_TOKEN || !cfg.TWILIO_FROM) {
      throw new Error('Twilio env vars missing (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM)');
    }
    instance = new TwilioSmsSender(cfg.TWILIO_ACCOUNT_SID, cfg.TWILIO_AUTH_TOKEN, cfg.TWILIO_FROM);
  } else {
    instance = new MemorySmsSender();
  }
  return instance;
}
