import Anthropic from '@anthropic-ai/sdk';
import type { LLMClient, LLMResponse } from '../interpret/cluster';

/**
 * Creates an LLM client backed by the Anthropic Claude API.
 * Requires ANTHROPIC_API_KEY environment variable.
 */
export function createAnthropicClient(model?: string): LLMClient | null {
  if (!process.env.ANTHROPIC_API_KEY) {
    return null;
  }

  const client = new Anthropic();
  const modelId = model || 'claude-sonnet-4-20250514';

  return {
    async complete(prompt: string, responseSchema: object): Promise<LLMResponse> {
      const response = await client.messages.create({
        model: modelId,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
        system: 'You are a code analysis assistant. Respond with valid JSON only, no markdown fences.',
      });

      // Extract text content
      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text response from LLM');
      }

      // Parse JSON from response
      const content = JSON.parse(textBlock.text);

      return {
        content,
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
        },
      };
    },
  };
}
