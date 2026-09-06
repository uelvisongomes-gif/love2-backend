import { describe, it, expect } from 'vitest';
import { MemoryLlmProvider } from './llm.js';

describe('MemoryLlmProvider', () => {
  it('returns enqueued responses in order and records calls', async () => {
    const m = new MemoryLlmProvider();
    m.enqueue('Olá');
    m.enqueue('Como posso ajudar?');
    const r1 = await m.complete([{ role: 'user', content: 'oi' }]);
    const r2 = await m.complete([{ role: 'user', content: 'help' }]);
    expect(r1.text).toBe('Olá');
    expect(r2.text).toBe('Como posso ajudar?');
    expect(m.calls).toHaveLength(2);
    expect(m.calls[0].messages[0].content).toBe('oi');
  });

  it('throws when the queue is empty', async () => {
    const m = new MemoryLlmProvider();
    await expect(m.complete([{ role: 'user', content: 'x' }])).rejects.toThrow(/queue is empty/i);
  });
});
