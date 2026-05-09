import { type ManifestV3Export } from '@crxjs/vite-plugin';

const manifest: ManifestV3Export = {
  manifest_version: 3,
  name: 'Multi AI Web Automation',
  version: '0.1.0',
  description: 'Send one prompt to multiple AI web apps and view answers in one side panel',
  permissions: ['tabs', 'storage', 'scripting', 'sidePanel'],
  host_permissions: [
    'https://chatgpt.com/*',
    'https://gemini.google.com/*',
    'https://chat.deepseek.com/*',
    'https://*.deepseek.com/*',
  ],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  side_panel: {
    default_path: 'public/sidepanel.html',
  },
  content_scripts: [
    {
      matches: [
        'https://chatgpt.com/*',
        'https://gemini.google.com/*',
        'https://chat.deepseek.com/*',
        'https://*.deepseek.com/*',
      ],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
  action: {
    default_title: 'Open Multi AI Panel',
    default_popup: 'public/popup.html',
  },
  icons: {
    '16': 'public/icon-16.png',
    '48': 'public/icon-48.png',
    '128': 'public/icon-128.png',
  },
};

export default manifest;
