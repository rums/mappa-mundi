import { spawn } from 'node:child_process';
import type { LLMClient, LLMResponse } from '../interpret/cluster';

/**
 * Run `claude --print` with the prompt piped via stdin.
 * This avoids OS argument length limits for large prompts.
 */
function claudePrint(prompt: string, systemPrompt?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['--print', '--output-format', 'text'];
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    const child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}: ${stderr.slice(0, 500)}`));
      } else {
        resolve(stdout);
      }
    });

    // Pipe prompt via stdin
    child.stdin.write(prompt);
    child.stdin.end();

    // 3 minute timeout
    setTimeout(() => {
      child.kill();
      reject(new Error('claude --print timed out after 180s'));
    }, 180_000);
  });
}

/**
 * Creates an LLM client that shells out to `claude --print`.
 * No API key needed — uses whatever auth Claude Code already has.
 */
export function createClaudeCodeClient(): LLMClient {
  return {
    async complete(prompt: string, responseSchema: object): Promise<LLMResponse> {
      const schemaHint = Object.keys(responseSchema).length > 0
        ? `\n\nRespond with valid JSON matching this schema:\n${JSON.stringify(responseSchema, null, 2)}`
        : '';

      const systemPrompt = 'You are a code analysis assistant. Respond with valid JSON only, no markdown fences or explanation.';
      const fullPrompt = `${prompt}${schemaHint}`;

      const stdout = await claudePrint(fullPrompt, systemPrompt);

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
