import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from '../config.js';

export type LlmRole = 'user' | 'assistant' | 'system';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmCallOptions {
  model?: string;
  system?: string;
  maxTokens?: number;
}

export interface LlmResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
}

export interface LlmProvider {
  complete(messages: LlmMessage[], opts?: LlmCallOptions): Promise<LlmResult>;
}

export class MemoryLlmProvider implements LlmProvider {
  public calls: { messages: LlmMessage[]; opts?: LlmCallOptions }[] = [];
  private queue: string[] = [];

  enqueue(text: string): void {
    this.queue.push(text);
  }

  async complete(messages: LlmMessage[], opts?: LlmCallOptions): Promise<LlmResult> {
    this.calls.push({ messages, opts });
    if (this.queue.length === 0) throw new Error('MemoryLlmProvider: response queue is empty');
    const text = this.queue.shift()!;
    return { text, inputTokens: 0, outputTokens: 0, stopReason: 'end_turn' };
  }
}

export class AnthropicLlmProvider implements LlmProvider {
  private client: Anthropic;
  private defaultModel: string;

  constructor(apiKey: string, defaultModel: string) {
    this.client = new Anthropic({ apiKey });
    this.defaultModel = defaultModel;
  }

  async complete(messages: LlmMessage[], opts?: LlmCallOptions): Promise<LlmResult> {
    const systemFromMessages = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content);
    const conversation = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    const system = [opts?.system, ...systemFromMessages].filter(Boolean).join('\n\n') || undefined;

    const response = await this.client.messages.create({
      model: opts?.model ?? this.defaultModel,
      max_tokens: opts?.maxTokens ?? 4096,
      system,
      messages: conversation,
    });

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    );
    return {
      text: textBlock?.text ?? '',
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      stopReason: response.stop_reason ?? 'end_turn',
    };
  }
}

let instance: LlmProvider | null = null;

export function setLlmProvider(p: LlmProvider): void {
  instance = p;
}

export function getLlmProvider(): LlmProvider {
  if (instance) return instance;
  const cfg = loadConfig();
  if (cfg.LLM_PROVIDER === 'anthropic') {
    if (!cfg.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic');
    }
    instance = new AnthropicLlmProvider(cfg.ANTHROPIC_API_KEY, cfg.LLM_MODEL);
  } else {
    instance = new MemoryLlmProvider();
  }
  return instance;
}
