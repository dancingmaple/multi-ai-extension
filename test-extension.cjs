const puppeteer = require('puppeteer');
const path = require('path');
const os = require('os');
const fs = require('fs');

const EXTENSION_PATH = path.resolve(__dirname, 'dist');
const USER_DATA_DIR = path.join(os.tmpdir(), 'puppeteer-test-profile-' + Date.now());

async function main() {
  // Create user data dir if it doesn't exist
  if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  }

  console.log('Extension path:', EXTENSION_PATH);
  console.log('User data dir:', USER_DATA_DIR);
  console.log('Launching Chrome with extension...');
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    userDataDir: USER_DATA_DIR,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    defaultViewport: null,
  });

  // Find the extension's background service worker
  const targets = await browser.targets();
  const extensionTarget = targets.find(
    (t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://')
  );

  if (!extensionTarget) {
    console.error('No extension service worker found!');
    // List all targets to debug
    console.log('Available targets:');
    for (const t of targets) {
      console.log(`  ${t.type()}: ${t.url()}`);
    }
    await browser.close();
    return;
  }

  console.log('Extension service worker found:', extensionTarget.url());
  const extensionId = new URL(extensionTarget.url()).hostname;
  console.log('Extension ID:', extensionId);

  // Navigate to a test page (ChatGPT)
  console.log('\nOpening ChatGPT...');
  const page = await browser.newPage();
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('Page loaded:', page.url());

  // Wait for page to settle
  await new Promise(r => setTimeout(r, 5000));

  // Check if content script is loaded
  const contentScriptLoaded = await page.evaluate(() => {
    return !!document.querySelector('[data-multi-ai-injected]');
  });
  console.log('Content script injected:', contentScriptLoaded);

  // Check console output
  page.on('console', (msg) => {
    if (msg.text().includes('[MultiAI')) {
      console.log('[BROWSER]', msg.text());
    }
  });

  // Try to open the extension popup
  console.log('\nTrying to open extension popup...');
  const popupPage = await browser.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/public/popup.html`, {
    waitUntil: 'domcontentloaded',
  });
  console.log('Popup page loaded:', popupPage.url());

  // Wait and observe
  await new Promise(r => setTimeout(r, 3000));

  // Check popup rendering
  const popupTitle = await popupPage.evaluate(() => document.title);
  console.log('Popup title:', popupTitle);

  // Check if the Send button exists
  const hasSendButton = await popupPage.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent?.includes('Send')) return true;
    }
    return false;
  });
  console.log('Send button visible:', hasSendButton);

  // Try to send a test prompt
  if (hasSendButton) {
    console.log('\nTrying to send a test prompt...');
    await popupPage.evaluate(() => {
      const textarea = document.querySelector('textarea');
      if (textarea) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        ).set;
        nativeInputValueSetter.call(textarea, 'Hello, test message!');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      // Click send
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent?.includes('Send')) {
          btn.click();
          break;
        }
      }
    });

    await new Promise(r => setTimeout(r, 5000));

    // Check for any response in the popup
    const statusText = await popupPage.evaluate(() => {
      const badges = document.querySelectorAll('span');
      const badgeTexts = Array.from(badges).map(b => b.textContent).filter(t => t);
      return badgeTexts.slice(0, 10);
    });
    console.log('Status badges:', statusText);
  }

  console.log('\nTest complete. Keeping browser open for 10 more seconds...');
  await new Promise(r => setTimeout(r, 10000));
  await browser.close();
  console.log('Browser closed.');
  // Clean up temp profile
  fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
}

main().catch((err) => {
  console.error('Test failed:', err);
  // Clean up
  if (fs.existsSync(USER_DATA_DIR)) {
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  }
  process.exit(1);
});
