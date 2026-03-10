import { describe, expect, it } from 'vitest';
import { buildChatPrompt } from '@/lib/jarvis/prompts';

describe('jarvis prompts', () => {
  it('injects context block in prompt', () => {
    const prompt = buildChatPrompt({ user_trades: [], macro_summary: null, memory: [] }, 'hello');
    expect(prompt).toContain('<context>');
    expect(prompt).toContain('hello');
  });
});
