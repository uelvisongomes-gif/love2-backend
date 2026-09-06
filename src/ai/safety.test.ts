import { describe, it, expect } from 'vitest';
import { screen, assessMessage, SAFETY_EMERGENCY_MESSAGE } from './safety.js';

describe('safety.screen', () => {
  it('detects violence keywords in pt-BR', () => {
    expect(screen('ele me bateu ontem').category).toBe('violence');
    expect(screen('ele me agrediu').category).toBe('violence');
  });

  it('detects suicide ideation', () => {
    expect(screen('quero me matar').category).toBe('suicide');
    expect(screen('não quero mais viver').category).toBe('suicide');
  });

  it('returns safe for benign text', () => {
    expect(screen('tivemos uma briga chata hoje mas conversamos').category).toBe('safe');
  });

  it('is case-insensitive', () => {
    expect(screen('ELE ME BATEU').category).toBe('violence');
  });
});

describe('SAFETY_EMERGENCY_MESSAGE', () => {
  it('includes all required hotlines', () => {
    expect(SAFETY_EMERGENCY_MESSAGE).toContain('188');
    expect(SAFETY_EMERGENCY_MESSAGE).toContain('180');
    expect(SAFETY_EMERGENCY_MESSAGE).toContain('192');
    expect(SAFETY_EMERGENCY_MESSAGE).toContain('190');
  });
});

describe('safety.assessMessage', () => {
  it('short-circuits on deterministic match without calling classifier', async () => {
    let called = false;
    const finding = await assessMessage('ele me bateu', async () => {
      called = true;
      return { category: 'safe', matched: [], source: 'classifier' };
    });
    expect(finding.category).toBe('violence');
    expect(called).toBe(false);
  });

  it('falls through to classifier when deterministic returns safe', async () => {
    const finding = await assessMessage('parábolas ambíguas', async () => ({
      category: 'suicide',
      matched: ['classifier_flag'],
      source: 'classifier',
    }));
    expect(finding.category).toBe('suicide');
    expect(finding.source).toBe('classifier');
  });
});
