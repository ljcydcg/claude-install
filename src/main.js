const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { addPathEntries, buildNpmGlobalBinPath, buildToolStatus, buildScanEnv, buildProxyEnvLines, normalizeProxyProfiles, upsertProxyProfile, removeProxyProfile, applyProxyProfileToConfig, buildClaudeSettings, writeCodexSettings } = require('./scanner');

// 打包成单 exe 后，程序不能依赖 D:\\claude-install 这类开发机路径。
// 用户配置和日志放到 Electron 的 userData 目录，确保换电脑也能直接运行。
const DATA = path.join(app.getPath('userData'), 'data');
const CONFIG = path.join(DATA, 'config.json');
const LOG = path.join(DATA, 'install.log');
const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
fs.mkdirSync(DATA, { recursive: true });

const DEFAULT_INSTALL_DIR = path.join(os.homedir(), 'ai-cli-tools');

const defaults = {
  installDir: DEFAULT_INSTALL_DIR,
  npmPrefix: path.join(DEFAULT_INSTALL_DIR, 'npm-global'),
  codex: { enabled: true, package: '@openai/codex', provider: 'rightcode', model: 'gpt-5.5', baseUrl: 'http://localhost:3000/v1', apiKey: '' },
  claude: { enabled: true, package: '@anthropic-ai/claude-code', baseUrl: 'http://localhost:3000/v1', apiKey: '' },
  activeProxyProfile: '本机 OpenClaw',
  proxyProfiles: [
    { name: '本机 OpenClaw', codexBaseUrl: 'http://localhost:3000/v1', codexApiKey: '', claudeBaseUrl: 'http://localhost:3000/v1', claudeApiKey: '' }
  ]
};

function mergeConfig(cfg) {
  const merged = {
    ...defaults,
    ...(cfg || {}),
    codex: { ...defaults.codex, ...((cfg || {}).codex || {}) },
    claude: { ...defaults.claude, ...((cfg || {}).claude || {}) },
    proxyProfiles: normalizeProxyProfiles((cfg || {}).proxyProfiles || defaults.proxyProfiles)
  };
  return merged;
}
function readConfig() {
  if (!fs.existsSync(CONFIG)) return mergeConfig(defaults);
  try { return mergeConfig(JSON.parse(fs.readFileSync(CONFIG, 'utf8'))); }
  catch { return mergeConfig(defaults); }
}
function writeConfig(cfg) { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(CONFIG, JSON.stringify(mergeConfig(cfg), null, 2), 'utf8'); }
function readJsonFile(file, fallback = {}) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; }
  catch { return fallback; }
}
function writeClaudeSettings(cfg) {
  fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
  const current = readJsonFile(CLAUDE_SETTINGS, {});
  const next = buildClaudeSettings(current, mergeConfig(cfg));
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(next, null, 2), 'utf8');
  appendLog(`WROTE Claude Code settings ${CLAUDE_SETTINGS}`);
  return CLAUDE_SETTINGS;
}
function writeCodexCliSettings(cfg) {
  const merged = mergeConfig(cfg);
  if (!merged.codex?.enabled) return [];
  const results = writeCodexSettings(merged);
  for (const r of results) {
    appendLog(`WROTE Codex config ${r.configPath}`);
    appendLog(`WROTE Codex auth ${r.authPath}`);
    appendLog(`VERIFY Codex config=${r.configMessage}; auth=${r.authMessage}`);
  }
  return results;
}
function appendLog(s) { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${s}\n`, 'utf8'); }
function redact(s) { return String(s || '').replace(/(sk-[A-Za-z0-9_-]{8,})/g, 'sk-***').replace(/(Bearer\s+)[^\s]+/g, '$1***'); }

let mainWindow;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1050, height: 760,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

function runCommand(command, args, opts = {}) {
  return new Promise((resolve) => {
    appendLog(`RUN ${command} ${args.join(' ')}`);
    const child = spawn(command, args, { shell: true, windowsHide: false, ...opts });
    let output = '';
    child.stdout.on('data', d => { const t = d.toString(); output += t; mainWindow?.webContents.send('log', redact(t)); });
    child.stderr.on('data', d => { const t = d.toString(); output += t; mainWindow?.webContents.send('log', redact(t)); });
    child.on('close', code => { appendLog(`EXIT ${code}\n${redact(output).slice(-4000)}`); resolve({ code, output: redact(output) }); });
    child.on('error', err => resolve({ code: -1, output: String(err) }));
  });
}

function runProcess(command, args, opts = {}) {
  return new Promise((resolve) => {
    appendLog(`RUN ${command} ${args.join(' ')}`);
    const child = spawn(command, args, { windowsHide: true, ...opts });
    let output = '';
    child.stdout.on('data', d => { const t = d.toString(); output += t; mainWindow?.webContents.send('log', redact(t)); });
    child.stderr.on('data', d => { const t = d.toString(); output += t; mainWindow?.webContents.send('log', redact(t)); });
    child.on('close', code => { appendLog(`EXIT ${code}\n${redact(output).slice(-4000)}`); resolve({ code, output: redact(output) }); });
    child.on('error', err => resolve({ code: -1, output: String(err) }));
  });
}

function withCommonNodePath(env = process.env) {
  const nodeDir = 'C:\\Program Files\\nodejs';
  const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'Path';
  const currentPath = env[pathKey] || '';
  return { ...env, [pathKey]: currentPath.includes(nodeDir) ? currentPath : `${nodeDir};${currentPath}` };
}

function addToCurrentProcessPath(entry) {
  const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') || 'Path';
  process.env[pathKey] = addPathEntries(process.env[pathKey] || '', [entry]);
}

function powershellPath() {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

async function ensureUserPathEntry(entry) {
  const binPath = String(entry || '').trim();
  if (!binPath) return { code: 0, output: 'No npm global bin path configured.' };
  addToCurrentProcessPath(binPath);
  if (process.platform !== 'win32') {
    return { code: 0, output: `Updated current process PATH with ${binPath}.` };
  }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$entry = $args[0].Trim().TrimEnd('\\')",
    "$current = [Environment]::GetEnvironmentVariable('Path', 'User')",
    '$parts = @()',
    'if ($current) {',
    "  $parts = $current -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ }",
    '}',
    '$exists = $false',
    'foreach ($part in $parts) {',
    "  if ($part.TrimEnd('\\').Equals($entry, [StringComparison]::OrdinalIgnoreCase)) {",
    '    $exists = $true',
    '    break',
    '  }',
    '}',
    'if (-not $exists) {',
    "  $next = @($parts + $entry) -join ';'",
    "  [Environment]::SetEnvironmentVariable('Path', $next, 'User')",
    "  $signature = '[DllImport(\"user32.dll\", SetLastError=true, CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);'",
    "  try { Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition $signature -ErrorAction Stop } catch {}",
    '  $sendResult = [UIntPtr]::Zero',
    "  [Win32.NativeMethods]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 0x2, 5000, [ref]$sendResult) | Out-Null",
    "  Write-Output \"added $entry\"",
    '} else {',
    "  Write-Output \"already present $entry\"",
    '}'
  ].join('\n');
  const result = await runProcess(powershellPath(), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script, binPath]);
  return {
    code: result.code,
    output: result.code === 0
      ? `${result.output.trim()}\nOpen a new terminal to use codex and claude directly.`
      : `Failed to update user PATH for ${binPath}.\n${result.output}`
  };
}

async function commandOk(command, args = ['--version'], opts = {}) {
  const r = await runCommand(command, args, opts);
  return { ok: r.code === 0, ...r };
}

async function getNodeEnvironmentStatus(env = process.env) {
  const checkEnv = withCommonNodePath(env);
  const node = await commandOk('node', ['--version'], { env: checkEnv });
  const npm = await commandOk('npm', ['--version'], { env: checkEnv });
  return { ok: node.ok && npm.ok, node, npm, env: checkEnv };
}

async function ensureNodeEnvironment(env = process.env) {
  mainWindow?.webContents.send('log', '\n=== NODE ENV CHECK ===\n');
  let status = await getNodeEnvironmentStatus(env);
  mainWindow?.webContents.send('log', `node: ${status.node.ok ? status.node.output.trim() : '未检测到'}\n`);
  mainWindow?.webContents.send('log', `npm: ${status.npm.ok ? status.npm.output.trim() : '未检测到'}\n`);
  appendLog(`NODE CHECK node=${status.node.ok} npm=${status.npm.ok}`);
  if (status.ok) return status;

  mainWindow?.webContents.send('log', '\n未检测到完整 Node.js/npm 环境，开始执行 Node.js LTS 安装指令...\n');
  appendLog('NODE MISSING: installing OpenJS.NodeJS.LTS via winget');
  const winget = await commandOk('winget', ['--version']);
  if (!winget.ok) {
    return { ...status, ok: false, error: '未检测到 winget，无法自动安装 Node.js。请手动安装 Node.js LTS：https://nodejs.org/' };
  }

  const install = await runCommand('winget', [
    'install',
    'OpenJS.NodeJS.LTS',
    '-e',
    '--accept-package-agreements',
    '--accept-source-agreements'
  ]);
  if (install.code !== 0) {
    return { ...status, ok: false, install, error: `Node.js LTS 安装指令失败，退出码 ${install.code}` };
  }

  status = await getNodeEnvironmentStatus(env);
  mainWindow?.webContents.send('log', '\n=== NODE ENV RECHECK ===\n');
  mainWindow?.webContents.send('log', `node: ${status.node.ok ? status.node.output.trim() : '仍未检测到'}\n`);
  mainWindow?.webContents.send('log', `npm: ${status.npm.ok ? status.npm.output.trim() : '仍未检测到'}\n`);
  if (!status.ok) {
    status.error = 'Node.js/npm 安装后仍未在当前进程 PATH 中检测到；请重启桌面程序后再点安装。';
  }
  return status;
}

ipcMain.handle('config:get', () => readConfig());
ipcMain.handle('config:save', (_, cfg) => { writeConfig(cfg); return readConfig(); });
ipcMain.handle('proxy:save-profile', (_, cfg, profile) => {
  const next = mergeConfig(cfg);
  next.proxyProfiles = upsertProxyProfile(next.proxyProfiles, profile);
  next.activeProxyProfile = profile.name;
  writeConfig(next);
  return readConfig();
});
ipcMain.handle('proxy:delete-profile', (_, cfg, name) => {
  const next = mergeConfig(cfg);
  next.proxyProfiles = removeProxyProfile(next.proxyProfiles, name);
  if (next.activeProxyProfile === name) next.activeProxyProfile = next.proxyProfiles[0]?.name || '';
  writeConfig(next);
  return readConfig();
});
ipcMain.handle('proxy:apply-profile', async (_, cfg, name) => {
  const current = mergeConfig(cfg);
  const profile = current.proxyProfiles.find(p => p.name === name);
  if (!profile) return { ok: false, error: `未找到中转配置：${name}`, config: current };
  const next = applyProxyProfileToConfig(current, profile);
  writeConfig(next);
  await writeEnvFiles(next);
  writeClaudeSettings(next);
  return { ok: true, config: readConfig() };
});
ipcMain.handle('dialog:dir', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('log:read', () => fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '');

ipcMain.handle('install:all', async (_, cfg) => {
  cfg = { ...defaults, ...cfg };
  writeConfig(cfg);
  fs.mkdirSync(cfg.installDir, { recursive: true });
  fs.mkdirSync(cfg.npmPrefix, { recursive: true });
  let env = { ...process.env, npm_config_prefix: cfg.npmPrefix };

  const results = [];
  const nodeStatus = await ensureNodeEnvironment(env);
  results.push({
    code: nodeStatus.ok ? 0 : -1,
    output: nodeStatus.ok
      ? `Node.js/npm 已就绪\nnode: ${nodeStatus.node.output.trim()}\nnpm: ${nodeStatus.npm.output.trim()}`
      : `Node.js/npm 未就绪：${nodeStatus.error || '未知错误'}`
  });
  if (!nodeStatus.ok) return results;
  env = { ...nodeStatus.env, npm_config_prefix: cfg.npmPrefix };

  results.push(await runCommand('npm', ['config', 'set', 'prefix', JSON.stringify(cfg.npmPrefix)], { env }));
  if (cfg.codex?.enabled) results.push(await runCommand('npm', ['install', '-g', cfg.codex.package || '@openai/codex'], { env }));
  if (cfg.claude?.enabled) results.push(await runCommand('npm', ['install', '-g', cfg.claude.package || '@anthropic-ai/claude-code'], { env }));
  const writeResult = await writeEnvFiles(cfg);
  results.push({ code: writeResult.pathResult.code, output: writeResult.pathResult.output });
  return results;
});

async function writeEnvFiles(cfg) {
  fs.mkdirSync(cfg.installDir, { recursive: true });
  const envFile = path.join(cfg.installDir, 'ai-cli-env.cmd');
  const bashFile = path.join(cfg.installDir, 'ai-cli-env.sh');
  const binPath = buildNpmGlobalBinPath(cfg.npmPrefix);
  const proxyLines = buildProxyEnvLines(cfg);
  const cmd = [
    '@echo off',
    `set "PATH=${binPath};%PATH%"`,
    proxyLines.cmd,
    'echo AI CLI environment loaded.'
  ].filter(Boolean).join('\r\n');
  fs.writeFileSync(envFile, cmd, 'utf8');
  const sh = [
    `export PATH="${binPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1')}:$PATH"`,
    proxyLines.sh
  ].filter(Boolean).join('\n');
  fs.writeFileSync(bashFile, sh, 'utf8');
  if (cfg.codex?.enabled) writeCodexCliSettings(cfg);
  writeClaudeSettings(cfg);
  const pathResult = await ensureUserPathEntry(binPath);
  appendLog(`USER PATH ${pathResult.code === 0 ? 'OK' : 'FAILED'} ${binPath}`);
  appendLog(`WROTE env files ${envFile} ${bashFile}`);
  return { envFile, bashFile, binPath, pathResult };
}

ipcMain.handle('config:apply', async (_, cfg) => { writeConfig(cfg); await writeEnvFiles(cfg); return { ok: true }; });
async function scanInstalledTools(cfg) {
  cfg = { ...defaults, ...cfg };
  const env = buildScanEnv(cfg, process.env);
  const codexVersion = await runCommand('codex', ['--version'], { env });
  const codexPath = codexVersion.code === 0 ? await runCommand('where', ['codex'], { env }) : { code: -1, output: '' };
  const claudeVersion = await runCommand('claude', ['--version'], { env });
  const claudePath = claudeVersion.code === 0 ? await runCommand('where', ['claude'], { env }) : { code: -1, output: '' };
  const codex = buildToolStatus('codex', codexVersion, codexPath);
  const claude = buildToolStatus('claude', claudeVersion, claudePath);
  return { codex, claude, scannedAt: new Date().toISOString() };
}

ipcMain.handle('check:versions', async (_, cfg) => {
  const scan = await scanInstalledTools(cfg);
  return { codex: scan.codex, claude: scan.claude };
});
ipcMain.handle('tools:scan', async (_, cfg) => scanInstalledTools(cfg));
