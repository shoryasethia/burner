import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(__dirname, '..', 'web');
const outDir = path.join(os.homedir(), '.burner-cc-cache');

export function renderReceipts(sessions) {
  mkdirSync(outDir, { recursive: true });

  const template = readFileSync(path.join(webDir, 'receipt.html'), 'utf-8');
  const injected = template.replace(
    '/*__BURNER_DATA__*/[]',
    JSON.stringify(sessions)
  );

  const outHtml = path.join(outDir, 'receipt.html');
  writeFileSync(outHtml, injected, 'utf-8');
  copyFileSync(path.join(webDir, 'receipt.css'), path.join(outDir, 'receipt.css'));
  copyFileSync(path.join(webDir, 'receipt.js'), path.join(outDir, 'receipt.js'));

  return outHtml;
}

export function openInBrowser(filePath) {
  const platform = process.platform;
  const cmd = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '""', filePath] : [filePath];
  spawn(cmd, args, { detached: true, stdio: 'ignore', shell: false }).unref();
}
