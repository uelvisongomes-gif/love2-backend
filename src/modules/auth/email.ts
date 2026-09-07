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
    });
    this.from = from;
  }
  async send(to: string, subject: string, text: string, html?: string): Promise<void> {
    await this.transporter.sendMail({ from: this.from, to, subject, text, html });
  }
}

let instance: EmailSender | null = null;

export function setEmailSender(sender: EmailSender): void {
  instance = sender;
}

export function getEmailSender(): EmailSender {
  if (instance) return instance;
  const cfg = loadConfig();
  if (cfg.EMAIL_DRIVER === 'smtp') {
    if (!cfg.SMTP_HOST || !cfg.SMTP_PORT || !cfg.SMTP_USER || !cfg.SMTP_PASS || !cfg.EMAIL_FROM) {
      throw new Error('SMTP env vars missing (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM)');
    }
    instance = new SmtpEmailSender(cfg.SMTP_HOST, cfg.SMTP_PORT, cfg.SMTP_USER, cfg.SMTP_PASS, cfg.EMAIL_FROM);
  } else {
    instance = new MemoryEmailSender();
  }
  return instance;
}
