import { type ManifestV3Export } from '@crxjs/vite-plugin';

const manifest: ManifestV3Export = {
  manifest_version: 3,
  name: 'Multi AI Web Automation',
  version: '1.0.0',
  description: 'Send one prompt to 6 AI web apps and view answers side by side',
  permissions: ['tabs', 'storage', 'scripting', 'sidePanel', 'webNavigation', 'alarms', 'downloads', 'debugger', 'declarativeNetRequestWithHostAccess', 'contextMenus'],
  host_permissions: [
    'https://chatgpt.com/*',
    'https://gemini.google.com/*',
    'https://chat.deepseek.com/*',
    'https://*.deepseek.com/*',
    'https://chat.qwen.ai/*',
    'https://chat.z.ai/*',
    'https://www.doubao.com/*',
    'https://kimi.moonshot.cn/*',
    'https://*.moonshot.cn/*',
    'https://kimi.com/*',
  ],
  externally_connectable: {
    matches: [
      'http://localhost/*',
      'http://127.0.0.1/*',
      // 'file:///*',
    ],
  },
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
        'https://chat.qwen.ai/*',
        'https://chat.z.ai/*',
        'https://www.doubao.com/*',
        'https://kimi.moonshot.cn/*',
        'https://*.moonshot.cn/*',
        'https://kimi.com/*',
      ],
      js: ['src/content/index.ts'],
      run_at: 'document_end',
      all_frames: true,
    },
  ],
  action: {
    default_title: 'Open Multi AI Panel',
  },
  icons: {
    '16': 'public/icon-16.png',
    '48': 'public/icon-48.png',
    '128': 'public/icon-128.png',
  },
};

export default manifest;