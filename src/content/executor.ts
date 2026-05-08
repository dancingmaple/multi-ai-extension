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

  try {
    sendStatus('sending', 'Locating input...');
    await adapter.waitForReady();

    if (adapter.detectLoginRequired()) {
      sendStatus('login_required', 'Login required');
      sendError('LOGIN_REQUIRED', `${msg.provider} requires login`);
      return;
    }

    await adapter.setPrompt(msg.prompt);

    sendStatus('sending', 'Submitting...');
    await adapter.submit();

    sendStatus('streaming');
    adapter.startStreaming(
      (text) => sendStream(text),
      (final) => {
        sendStatus('done');
        sendDone(final);
      },
      (err) => {
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
    sendStatus('error', message);
    sendError('EXECUTION_FAILED', message);
  }
}
