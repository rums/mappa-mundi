import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { LLMClient, LLMResponse } from '../interpret/cluster';

const execFileAsync = promisify(execFile);

/**
 * Creates an LLM client that shells out to `claude --print`.
 * No API key needed — uses whatever auth Claude Code already has.
 */
export function createClaudeCodeClient(): LLMClient {
  return {
    async complete(prompt: string, responseSchema: object): Promise<LLMResponse> {
      const fullPrompt = `You are a code analysis assistant. Respond with valid JSON only, no markdown fences.\n\n${prompt}`;

      const { stdout } = await execFileAsync('claude', [
        '--print',
        '--output-format', 'text',
        fullPrompt,
      ], {
        maxBuffer: 1024 * 1024, // 1MB
        timeout: 120_000,       // 2 min
      });

      // Strip markdown fences if present
      let text = stdout.trim();
      if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      const content = JSON.parse(text);

      return {
        content,
        usage: { promptTokens: 0, completionTokens: 0 },
      };
    },
  };
}

/**
 * Creates an LLM client. Uses claude --print (no API key needed).
 * Set MAPPA_LLM=off to disable, or MAPPA_LLM=on to enable.
 * Defaults to on if not in test environment.
 */
export function createLLMClient(): LLMClient | null {
  const env = process.env.MAPPA_LLM;
  if (env === 'off') return null;

  // Skip in test environments unless explicitly enabled
  if (!env && process.env.NODE_ENV === 'test') return null;
  if (!env && process.env.VITEST) return null;

  return createClaudeCodeClient();
}
