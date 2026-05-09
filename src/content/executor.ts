import type { ProviderName, ExecutePromptMessage } from '../shared/types';
import type { SiteAdapter } from './adapters/base';
import { ChatGPTAdapter } from './adapters/chatgpt';
import { GeminiAdapter } from './adapters/gemini';
import { DeepSeekAdapter } from './adapters/deepseek';
import { LoginRequiredError } from '../shared/utils';

const adapters: Record<ProviderName, SiteAdapter> = {
  chatgpt: new ChatGPTAdapter(),
  gemini: new GeminiAdapter(),
  deepseek: new DeepSeekAdapter(),
};

export async function executePrompt(
  msg: ExecutePromptMessage,
  sendStatus: (status: string, detail?: string) => void,
  sendStream: (content: string) => void,
  sendDone: (finalContent: string) => void,
  sendError: (code: string, message: string) => void
): Promise<void> {
  const adapter = adapters[msg.provider];
  if (!adapter) {
    sendError('UNKNOWN_PROVIDER', `Unknown provider: ${msg.provider}`);
    return;
  }

  console.log('[MultiAI:executor] Starting execution for', msg.provider, 'prompt:', msg.prompt.substring(0, 80));

  try {
    sendStatus('sending', 'Locating input...');
    console.log('[MultiAI:executor] Waiting for page ready...');
    await adapter.waitForReady();
    console.log('[MultiAI:executor] Page ready');

    if (adapter.detectLoginRequired()) {
      console.log('[MultiAI:executor] Login required detected');
      sendStatus('login_required', 'Login required');
      sendError('LOGIN_REQUIRED', `${msg.provider} requires login`);
      return;
    }

    console.log('[MultiAI:executor] Setting prompt...');
    await adapter.setPrompt(msg.prompt);
    console.log('[MultiAI:executor] Prompt set, submitting...');

    sendStatus('sending', 'Submitting...');
    await adapter.submit();
    console.log('[MultiAI:executor] Submit done, starting stream capture');

    sendStatus('streaming');
    adapter.startStreaming(
      (text) => sendStream(text),
      (final) => {
        console.log('[MultiAI:executor] Streaming done, final length:', final.length);
        sendStatus('done');
        sendDone(final);
      },
      (err) => {
        console.error('[MultiAI:executor] Stream error:', err.message);
        if (err instanceof LoginRequiredError) {
          sendStatus('login_required');
        } else {
          sendStatus('error', err.message);
        }
        sendError('STREAM_FAILED', err.message);
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[MultiAI:executor] Execution failed:', message);
    sendStatus('error', message);
    sendError('EXECUTION_FAILED', message);
  }
}
