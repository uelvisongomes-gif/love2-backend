import nodemailer, { type Transporter } from 'nodemailer';
import { loadConfig } from '../../config.js';

export interface EmailSender {
  send(to: string, subject: string, text: string, html?: string): Promise<void>;
}

export class MemoryEmailSender implements EmailSender {
  public sent: { to: string; subject: string; text: string; html?: string }[] = [];
  async send(to: string, subject: string, text: string, html?: string): Promise<void> {
    this.sent.push({ to, subject, text, html });
  }
}

class SmtpEmailSender implements EmailSender {
  private transporter: Transporter;
  private from: string;
  constructor(host: string, port: number, user: string, pass: string, from: string) {
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    this.from = from;
  }
  async send(to: string, subject: string, text: string, html?: string): Promise<void> {
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, text, html });
    } catch (err) {
      const e = err as { code?: string; command?: string; response?: string; message?: string };
      console.error('[SMTP] send failed:', {
        code: e.code,
        command: e.command,
        response: e.response,
        message: e.message,
      });
      throw err;
    }
  }
}

function parseFrom(from: string): { email: string; name?: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1] || undefined, email: m[2] };
  return { email: from.trim() };
}

class BrevoApiEmailSender implements EmailSender {
  private apiKey: string;
  private from: { email: string; name?: string };
  constructor(apiKey: string, from: string) {
    this.apiKey = apiKey;
    this.from = parseFrom(from);
  }
  async send(to: string, subject: string, text: string, html?: string): Promise<void> {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': this.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: this.from,
        to: [{ email: to }],
        subject,
        textContent: text,
        htmlContent: html ?? text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[Brevo API] send failed:', { status: res.status, body });
      throw new Error(`Brevo API error ${res.status}: ${body}`);
    }
  }
}

let instance: EmailSender | null = null;

export function setEmailSender(sender: EmailSender): void {
  instance = sender;
}

export function getEmailSender(): EmailSender {
  if (instance) return instance;
  const cfg = loadConfig();
  if (cfg.EMAIL_DRIVER === 'brevo') {
    if (!cfg.BREVO_API_KEY || !cfg.EMAIL_FROM) {
      throw new Error('Brevo env vars missing (BREVO_API_KEY, EMAIL_FROM)');
    }
    instance = new BrevoApiEmailSender(cfg.BREVO_API_KEY, cfg.EMAIL_FROM);
  } else if (cfg.EMAIL_DRIVER === 'smtp') {
    if (!cfg.SMTP_HOST || !cfg.SMTP_PORT || !cfg.SMTP_USER || !cfg.SMTP_PASS || !cfg.EMAIL_FROM) {
      throw new Error('SMTP env vars missing (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM)');
    }
    instance = new SmtpEmailSender(cfg.SMTP_HOST, cfg.SMTP_PORT, cfg.SMTP_USER, cfg.SMTP_PASS, cfg.EMAIL_FROM);
  } else {
    instance = new MemoryEmailSender();
  }
  return instance;
}
