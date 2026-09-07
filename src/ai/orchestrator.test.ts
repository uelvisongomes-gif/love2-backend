import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '../db/client.js';
import { chatWithLove } from './orchestrator.js';
import { MemoryLlmProvider, setLlmProvider } from './llm.js';

const llm = new MemoryLlmProvider();

beforeEach(async () => {
  setLlmProvider(llm);
  await prisma.loveMessage.deleteMany();
  llm.calls.length = 0;
});
afterAll(() => prisma.$disconnect());

describe('chatWithLove', () => {
  it('short-circuits on unsafe input without invoking the LLM', async () => {
    const res = await chatWithLove({
      userId: 'u1',
      content: 'ele me bateu hoje',
      context: 'conflict',
    });
    expect(res.safety.category).toBe('violence');
    expect(res.reply).toContain('188');
    expect(res.reply).toContain('180');
    expect(llm.calls).toHaveLength(0);
    const stored = await prisma.loveMessage.findMany({ where: { userId: 'u1' } });
    expect(stored).toHaveLength(2);
    const assistant = stored.find((m) => m.role === 'assistant')!;
    expect(assistant.safetyCategory).toBe('violence');
  });

  it('runs the LLM path when safe and injects LOVE identity in system prompt', async () => {
    llm.enqueue('Sou a LOVE, mediadora do love2. Vamos conversar sobre escuta ativa.');

    const res = await chatWithLove({
      userId: 'u2',
      content: 'como melhorar a escuta ativa',
      context: 'general',
    });

    expect(res.safety.category).toBe('safe');
    expect(res.reply).toContain('LOVE');
    // No RAG yet — citations empty
    expect(res.citations).toEqual([]);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].opts?.system).toContain('LOVE');
    expect(llm.calls[0].opts?.system).toContain('mediadora');
  });

  it('respects allowedTopics — omits religion when the user opted out', async () => {
    llm.enqueue('resposta ok');
    await chatWithLove({
      userId: 'u3',
      content: 'oi',
      context: 'general',
      allowedTopics: ['comunicacao'],
    });
    expect(llm.calls[0].opts?.system).not.toMatch(/espiritual|religi/i);
  });
});
