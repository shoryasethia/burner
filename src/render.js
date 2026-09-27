import { readFileSync, writeFileSync, mkdirSync, copyFileSync, cpSync } from 'node:fs';
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
  // The logo has to be inlined as a data URI, not loaded as a separate
  // file:// resource — html2canvas's Download button taints the canvas
  // (SecurityError on toDataURL) if the receipt contains an <img> pulled
  // in as its own file:// fetch, even from the same local directory.
  const logoBase64 = readFileSync(path.join(webDir, 'logo-mark.png')).toString('base64');
  const logoDataUri = `data:image/png;base64,${logoBase64}`;

  const injected = template
    .replace('/*__BURNER_DATA__*/[]', JSON.stringify(sessions))
    .replace('/*__BURNER_LOGO_MARK__*/"logo-mark.png"', JSON.stringify(logoDataUri));

  const outHtml = path.join(outDir, 'receipt.html');
  writeFileSync(outHtml, injected, 'utf-8');
  copyFileSync(path.join(webDir, 'receipt.css'), path.join(outDir, 'receipt.css'));
  copyFileSync(path.join(webDir, 'receipt.js'), path.join(outDir, 'receipt.js'));
  copyFileSync(path.join(webDir, 'logo-mark.png'), path.join(outDir, 'logo-mark.png'));
  copyFileSync(path.join(webDir, 'logo-with-text.png'), path.join(outDir, 'logo-with-text.png'));
  cpSync(path.join(webDir, 'vendor'), path.join(outDir, 'vendor'), { recursive: true });

  return outHtml;
}

export function openInBrowser(filePath) {
  const platform = process.platform;
  const cmd = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '""', filePath] : [filePath];
  spawn(cmd, args, { detached: true, stdio: 'ignore', shell: false }).unref();
}
