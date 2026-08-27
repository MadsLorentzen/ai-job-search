import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loggerFor } from '../config/logger.js';

const log = loggerFor('ai');

/**
 * AI providers as data rather than a hardcoded if-ladder.
 *
 * `executePrompt` used to be four near-identical blocks that had to be edited
 * to add a provider, and testing the fallback order meant manipulating
 * environment variables. Each provider is now an object with the same shape,
 * so adding one is a list entry and tests can inject a fake.
 */

const CLI_TIMEOUT_MS = Number(process.env.CLAUDE_CLI_TIMEOUT_MS || 25000);
const HTTP_TIMEOUT_MS = Number(process.env.AI_HTTP_TIMEOUT_MS || 60000);

/** Shared implementation for every OpenAI-compatible chat endpoint. */
async function callOpenAICompatible({ apiKey, baseUrl, model, systemPrompt, userPrompt }) {
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  log.info({ model }, 'calling provider');

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 4000
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${model} returned HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || null;
}

function openAiCompatibleProvider({ id, label, keyVars, baseUrlVars, modelVars, defaultBaseUrl, defaultModel }) {
  const firstSet = (vars) => vars.map(v => process.env[v]).find(v => v && v.trim());

  return {
    id,
    label,
    isConfigured: () => Boolean(firstSet(keyVars)),
    async call(systemPrompt, userPrompt) {
      return callOpenAICompatible({
        apiKey: (firstSet(keyVars) || '').trim(),
        baseUrl: firstSet(baseUrlVars) || defaultBaseUrl,
        model: firstSet(modelVars) || defaultModel,
        systemPrompt,
        userPrompt
      });
    }
  };
}

const kimi = openAiCompatibleProvider({
  id: 'kimi',
  label: 'Kimi (Moonshot AI)',
  keyVars: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
  baseUrlVars: ['KIMI_BASE_URL', 'MOONSHOT_BASE_URL'],
  modelVars: ['KIMI_MODEL', 'MOONSHOT_MODEL'],
  defaultBaseUrl: 'https://api.moonshot.cn/v1',
  defaultModel: 'moonshot-v1-32k'
});

const qwen = openAiCompatibleProvider({
  id: 'qwen',
  label: 'Qwen (Alibaba AI)',
  keyVars: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'],
  baseUrlVars: ['QWEN_BASE_URL', 'DASHSCOPE_BASE_URL'],
  modelVars: ['QWEN_MODEL', 'DASHSCOPE_MODEL'],
  defaultBaseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  defaultModel: 'qwen-plus'
});

const openai = openAiCompatibleProvider({
  id: 'openai',
  label: 'OpenAI / Compatible',
  keyVars: ['OPENAI_API_KEY'],
  baseUrlVars: ['OPENAI_BASE_URL'],
  modelVars: ['OPENAI_MODEL'],
  defaultBaseUrl: 'https://api.openai.com/v1',
  defaultModel: 'gpt-4o'
});

let anthropicClient;
function getAnthropicClient() {
  if (anthropicClient !== undefined) return anthropicClient;

  const key = process.env.ANTHROPIC_API_KEY;
  if (key && key.trim() && !key.includes('your_anthropic_api_key')) {
    try {
      anthropicClient = new Anthropic({ apiKey: key.trim() });
      return anthropicClient;
    } catch (err) {
      log.warn({ err: err.message }, 'could not initialize Anthropic SDK');
    }
  }
  anthropicClient = null;
  return anthropicClient;
}

const anthropic = {
  id: 'anthropic',
  label: 'Claude (API key)',
  isConfigured: () => Boolean(getAnthropicClient()),
  async call(systemPrompt, userPrompt) {
    const client = getAnthropicClient();
    if (!client) return null;

    const response = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    // Read the first text block rather than assuming content[0] is one: an
    // empty array or a non-text leading block used to throw here.
    const text = (response.content || [])
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');
    return text.trim() || null;
  }
};

let cliAvailable;
const claudeCli = {
  id: 'claude-cli',
  label: 'Claude (CLI bridge)',

  /**
   * The presence of ~/.claude proves only that the CLI has run at some point,
   * not that anyone is logged in, so the binary must also be on PATH.
   */
  isConfigured() {
    if (cliAvailable !== undefined) return cliAvailable;

    const home = process.env.HOME || process.env.USERPROFILE || '';
    const hasConfig = home
      ? fs.existsSync(path.join(home, '.claude')) || fs.existsSync(path.join(home, '.claude.json'))
      : false;

    const onPath = (process.env.PATH || '').split(path.delimiter).some(dir => {
      try {
        return dir && fs.existsSync(path.join(dir, 'claude'));
      } catch {
        return false;
      }
    });

    cliAvailable = hasConfig && onPath;
    return cliAvailable;
  },

  call(systemPrompt, userPrompt) {
    return new Promise((resolve, reject) => {
      const proc = spawn('claude', ['-p'], { stdio: ['pipe', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(arg);
      };

      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        finish(reject, new Error(`Claude CLI timed out after ${CLI_TIMEOUT_MS}ms`));
      }, CLI_TIMEOUT_MS);

      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });

      // An EPIPE (child exited before the prompt finished writing) surfaces
      // asynchronously as an 'error' event, which is fatal if unhandled and
      // cannot be caught by a try/catch around the write.
      proc.stdin.on('error', err => finish(reject, err));
      proc.on('error', err => finish(reject, err));

      proc.on('close', code => {
        if (code === 0 && stdout.trim()) return finish(resolve, stdout);
        finish(reject, new Error(`Claude CLI exited with code ${code}: ${(stderr || stdout).slice(0, 300)}`));
      });

      proc.stdin.end(`${systemPrompt}\n\n${userPrompt}`);
    });
  }
};

/** Tried in order. The first configured provider that returns text wins. */
const REGISTRY = [kimi, qwen, openai, anthropic, claudeCli];

/** Test seam: swap the registry for fakes without touching the environment. */
let activeRegistry = REGISTRY;
export function setProviderRegistry(providers) {
  activeRegistry = providers || REGISTRY;
}
export function resetProviderRegistry() {
  activeRegistry = REGISTRY;
  cliAvailable = undefined;
  anthropicClient = undefined;
}

export function isDisabled() {
  return (process.env.AI_PROVIDER || '').toLowerCase() === 'none';
}

/**
 * Providers eligible for this request.
 * AI_PROVIDER pins a single provider; otherwise every configured one is tried
 * in registry order.
 */
export function availableProviders() {
  if (isDisabled()) return [];
  const pinned = (process.env.AI_PROVIDER || '').toLowerCase();
  const configured = activeRegistry.filter(p => p.isConfigured());
  if (!pinned) return configured;

  const match = activeRegistry.filter(p => p.id === pinned);
  return match.length ? match : configured;
}

export function describeProvider() {
  if (isDisabled()) return 'Disabled (AI_PROVIDER=none)';
  const [first] = availableProviders();
  return first ? first.label : 'None configured';
}

export function isConfigured() {
  return availableProviders().length > 0;
}

/**
 * Run a prompt through the first provider that answers.
 * Returns null when every provider is unavailable or fails, which callers
 * surface to the user rather than papering over with invented content.
 */
export async function executePrompt(systemPrompt, userPrompt) {
  for (const provider of availableProviders()) {
    try {
      const result = await provider.call(systemPrompt, userPrompt);
      if (result && result.trim()) return result;
      log.warn({ provider: provider.id }, 'provider returned no content');
    } catch (err) {
      log.warn({ provider: provider.id, err: err.message }, 'provider failed');
    }
  }
  return null;
}
