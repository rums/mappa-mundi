import { spawn } from 'node:child_process';
import type { LLMClient, LLMResponse } from '../interpret/cluster';

/**
 * Run `claude --print` with the prompt piped via stdin.
 */
function claudePrint(prompt: string, systemPrompt?: string, model?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['--print', '--output-format', 'text'];
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }
    if (model) {
      args.push('--model', model);
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

    child.stdin.write(prompt);
    child.stdin.end();

    // 3 minute timeout
    setTimeout(() => {
      child.kill();
      reject(new Error('claude --print timed out after 180s'));
    }, 180_000);
  });
}

function parseClaudeResponse(stdout: string): unknown {
  let text = stdout.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  return JSON.parse(text);
}

/**
 * Creates an LLM client that shells out to `claude --print`.
 * @param model — optional model override (e.g., 'haiku' for fast/cheap tasks)
 */
export function createClaudeCodeClient(model?: string): LLMClient {
  return {
    async complete(prompt: string, responseSchema: object): Promise<LLMResponse> {
      const schemaHint = Object.keys(responseSchema).length > 0
        ? `\n\nRespond with valid JSON matching this schema:\n${JSON.stringify(responseSchema, null, 2)}`
        : '';

      const systemPrompt = 'You are a code analysis assistant. Respond with valid JSON only, no markdown fences or explanation.';
      const fullPrompt = `${prompt}${schemaHint}`;

      const stdout = await claudePrint(fullPrompt, systemPrompt, model);
      const content = parseClaudeResponse(stdout);

      return {
        content,
        usage: { promptTokens: 0, completionTokens: 0 },
      };
    },
  };
}

/**
 * Creates the default LLM client (for clustering — uses default model).
 * Set MAPPA_LLM=off to disable.
 */
export function createLLMClient(): LLMClient | null {
  const env = process.env.MAPPA_LLM;
  if (env === 'off') return null;

  if (!env && process.env.NODE_ENV === 'test') return null;
  if (!env && process.env.VITEST) return null;

  return createClaudeCodeClient();
}

/**
 * Creates a fast LLM client using Haiku for layer evaluation.
 */
export function createFastLLMClient(): LLMClient | null {
  const env = process.env.MAPPA_LLM;
  if (env === 'off') return null;

  if (!env && process.env.NODE_ENV === 'test') return null;
  if (!env && process.env.VITEST) return null;

  return createClaudeCodeClient('haiku');
}
