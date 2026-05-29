const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { addPathEntries, buildNpmGlobalBinPath, buildToolStatus, buildScanEnv, buildProxyEnvLines, defaultCodexConfigTemplate, defaultClaudeConfigTemplate, buildClaudeSettings, writeCodexSettings } = require('./scanner');

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
  codex: { enabled: true, package: '@openai/codex', provider: 'rightcode', model: 'gpt-5.5', baseUrl: 'http://localhost:3000/v1', apiKey: '', configTemplate: defaultCodexConfigTemplate() },
  claude: { enabled: true, package: '@anthropic-ai/claude-code', baseUrl: 'http://localhost:3000/v1', apiKey: '', configTemplate: defaultClaudeConfigTemplate() }
};
const WINGET_INSTALLER_URL = 'https://aka.ms/getwinget';
const WINGET_USTC_SOURCE_NAME = 'ustc';
const WINGET_USTC_SOURCE_URL = 'https://mirrors.ustc.edu.cn/winget-source';

function mergeConfig(cfg) {
  const merged = {
    ...defaults,
    ...(cfg || {}),
    codex: { ...defaults.codex, ...((cfg || {}).codex || {}) },
    claude: { ...defaults.claude, ...((cfg || {}).claude || {}) }
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
function writeCodexCliSettings(cfg, force = false) {
  const merged = mergeConfig(cfg);
  if (!force && !merged.codex?.enabled) return [];
  const results = writeCodexSettings(merged);
  for (const r of results) {
    appendLog(`WROTE Codex config ${r.configPath}`);
    appendLog(`WROTE Codex auth ${r.authPath}`);
    appendLog(`VERIFY Codex config=${r.configMessage}; auth=${r.authMessage}`);
  }
  return results;
}
function normalizeApiTool(tool) {
  return tool === 'claude' ? 'claude' : 'codex';
}
function writeSelectedApiConfig(cfg, tool) {
  const merged = mergeConfig(cfg);
  const selected = normalizeApiTool(tool);
  if (selected === 'claude') return { tool: selected, settingsPath: writeClaudeSettings(merged) };
  return { tool: selected, results: writeCodexCliSettings(merged, true) };
}
function appendLog(s) { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${s}\n`, 'utf8'); }
function redact(s) { return String(s || '').replace(/(sk-[A-Za-z0-9_-]{8,})/g, 'sk-***').replace(/(Bearer\s+)[^\s]+/g, '$1***'); }
function tailOutput(result, limit = 1600) { return String(result?.output || '').trim().slice(-limit); }

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
    const { logArgs, ...spawnOpts } = opts;
    appendLog(`RUN ${command} ${(logArgs || args).join(' ')}`);
    const child = spawn(command, args, { windowsHide: true, ...spawnOpts });
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

function withPathEntries(env = process.env, entries = []) {
  const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'Path';
  return { ...env, [pathKey]: addPathEntries(env[pathKey] || '', entries) };
}

function commonWindowsAppsPath() {
  return path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WindowsApps');
}

function withCommonWingetPath(env = process.env) {
  return process.platform === 'win32' ? withPathEntries(env, [commonWindowsAppsPath()]) : env;
}

function powershellPath() {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function psString(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

async function runPowerShell(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return runProcess(
    powershellPath(),
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { logArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', '<encoded>'] }
  );
}

async function getWingetStatus(env = process.env) {
  const checkEnv = withCommonWingetPath(env);
  const winget = await commandOk('winget', ['--version'], { env: checkEnv });
  return { ...winget, env: checkEnv };
}

async function showWingetInstallFailureDialog(detail) {
  const message = '无法自动安装 winget';
  const body = [
    String(detail || '当前系统不支持自动安装，或下载安装 App Installer 失败。').trim(),
    '',
    `可以手动安装 App Installer / winget：${WINGET_INSTALLER_URL}`,
    `winget 可用后，程序会优先尝试使用国内源：${WINGET_USTC_SOURCE_URL}`
  ].join('\n');
  appendLog(`WINGET INSTALL FAILED: ${redact(body)}`);
  try {
    await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: message,
      message,
      detail: body,
      buttons: ['知道了']
    });
  } catch {}
}

async function installWingetWithAppInstaller() {
  if (process.platform !== 'win32') {
    return { code: -1, output: 'winget 自动安装仅支持 Windows。' };
  }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "if (-not (Get-Command Add-AppxPackage -ErrorAction SilentlyContinue)) { throw '当前系统不支持 Add-AppxPackage，无法自动安装 winget。' }",
    "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}",
    `$installerUrl = ${psString(WINGET_INSTALLER_URL)}`,
    "$tempDir = Join-Path $env:TEMP 'ClaudeCodexManager'",
    "New-Item -ItemType Directory -Force -Path $tempDir | Out-Null",
    "$bundle = Join-Path $tempDir 'Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle'",
    "Invoke-WebRequest -Uri $installerUrl -OutFile $bundle -UseBasicParsing",
    "Add-AppxPackage -Path $bundle",
    "Write-Output \"winget installer installed from $installerUrl\""
  ].join('\n');
  return runPowerShell(script);
}

async function registerWingetIfAppInstallerPresent() {
  if (process.platform !== 'win32') {
    return { code: -1, output: 'winget 注册仅支持 Windows。' };
  }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "if (-not (Get-Command Add-AppxPackage -ErrorAction SilentlyContinue)) { throw '当前系统不支持 Add-AppxPackage，无法注册 winget。' }",
    "Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe",
    "Write-Output 'requested winget registration for Microsoft.DesktopAppInstaller_8wekyb3d8bbwe'"
  ].join('\n');
  return runPowerShell(script);
}

function findWingetSourceName(output, sourceUrl) {
  const url = String(sourceUrl || '').toLowerCase();
  if (!url) return null;
  for (const line of String(output || '').split(/\r?\n/)) {
    if (!line.toLowerCase().includes(url)) continue;
    const name = line.trim().split(/\s+/)[0];
    if (name) return name;
  }
  return null;
}

async function ensureWingetDomesticSource(env = process.env) {
  mainWindow?.webContents.send('log', `\n=== WINGET SOURCE CHECK ===\n尝试配置国内镜像源：${WINGET_USTC_SOURCE_URL}\n`);
  const list = await runCommand('winget', ['source', 'list'], { env });
  const existingSourceName = findWingetSourceName(list.output, WINGET_USTC_SOURCE_URL);
  if (list.code === 0 && existingSourceName) {
    return { ok: true, sourceName: existingSourceName, output: list.output, list };
  }

  const addTrusted = await runCommand('winget', [
    'source',
    'add',
    '--name',
    WINGET_USTC_SOURCE_NAME,
    '--arg',
    WINGET_USTC_SOURCE_URL,
    '--trust-level',
    'trusted',
    '--accept-source-agreements'
  ], { env });

  let addLegacy = null;
  if (addTrusted.code !== 0) {
    addLegacy = await runCommand('winget', [
      'source',
      'add',
      '--name',
      WINGET_USTC_SOURCE_NAME,
      '--arg',
      WINGET_USTC_SOURCE_URL,
      '--accept-source-agreements'
    ], { env });
  }

  let addMinimal = null;
  if (addTrusted.code !== 0 && addLegacy?.code !== 0) {
    addMinimal = await runCommand('winget', [
      'source',
      'add',
      WINGET_USTC_SOURCE_NAME,
      WINGET_USTC_SOURCE_URL
    ], { env });
  }

  const addOk = addTrusted.code === 0 || addLegacy?.code === 0 || addMinimal?.code === 0;
  const update = addOk
    ? await runCommand('winget', ['source', 'update', '--name', WINGET_USTC_SOURCE_NAME], { env })
    : { code: -1, output: 'skip winget source update because source add failed' };
  const finalList = await runCommand('winget', ['source', 'list'], { env });
  const finalSourceName = findWingetSourceName(finalList.output, WINGET_USTC_SOURCE_URL);
  const ok = finalList.code === 0 && !!finalSourceName;
  const output = [
    `source list: ${list.code}`,
    tailOutput(list, 600),
    `source add trusted: ${addTrusted.code}`,
    tailOutput(addTrusted, 600),
    addLegacy ? `source add fallback: ${addLegacy.code}\n${tailOutput(addLegacy, 600)}` : '',
    addMinimal ? `source add minimal: ${addMinimal.code}\n${tailOutput(addMinimal, 600)}` : '',
    `source update: ${update.code}`,
    tailOutput(update, 600),
    `source list final: ${finalList.code}`,
    tailOutput(finalList, 600)
  ].filter(Boolean).join('\n');
  if (!ok) {
    mainWindow?.webContents.send('log', '\n国内镜像源配置失败，将回退使用 winget 默认源。\n');
  }
  return { ok, sourceName: ok ? finalSourceName : null, output, list, addTrusted, addLegacy, addMinimal, update, finalList };
}

async function ensureWingetAvailable(options = {}) {
  const showDialog = options.showDialog !== false;
  mainWindow?.webContents.send('log', '\n=== WINGET CHECK ===\n');
  if (process.platform !== 'win32') {
    const error = 'winget 仅支持 Windows，当前系统无法自动安装 winget。';
    if (showDialog) await showWingetInstallFailureDialog(error);
    return { ok: false, error, env: process.env };
  }

  let winget = await getWingetStatus(process.env);
  mainWindow?.webContents.send('log', `winget: ${winget.ok ? winget.output.trim() : '未检测到'}\n`);
  if (!winget.ok) {
    mainWindow?.webContents.send('log', '\n未检测到 winget，先尝试注册系统中的 App Installer...\n');
    const register = await registerWingetIfAppInstallerPresent();
    if (register.code === 0) {
      addToCurrentProcessPath(commonWindowsAppsPath());
      winget = await getWingetStatus(process.env);
      mainWindow?.webContents.send('log', `winget 注册后检测：${winget.ok ? winget.output.trim() : '仍未检测到'}\n`);
      if (winget.ok) {
        const mirror = await ensureWingetDomesticSource(winget.env);
        return { ok: true, installed: false, registered: true, winget, register, mirror, env: winget.env };
      }
    }

    mainWindow?.webContents.send('log', '\n注册后仍未检测到 winget，开始尝试安装 App Installer / winget...\n');
    appendLog('WINGET MISSING: installing App Installer');
    const install = await installWingetWithAppInstaller();
    if (install.code !== 0) {
      const error = `winget 自动安装失败，退出码 ${install.code}`;
      if (showDialog) await showWingetInstallFailureDialog(`${error}\n${tailOutput(install)}`);
      return { ok: false, error, winget, register, install, env: winget.env };
    }

    addToCurrentProcessPath(commonWindowsAppsPath());
    winget = await getWingetStatus(process.env);
    mainWindow?.webContents.send('log', '\n=== WINGET RECHECK ===\n');
    mainWindow?.webContents.send('log', `winget: ${winget.ok ? winget.output.trim() : '安装后仍未检测到'}\n`);
    if (!winget.ok) {
      const error = 'winget 安装后仍未在当前进程 PATH 中检测到；请重启桌面程序后再点安装。';
      if (showDialog) await showWingetInstallFailureDialog(`${error}\n${tailOutput(winget)}`);
      return { ok: false, error, winget, register, install, env: winget.env };
    }

    const mirror = await ensureWingetDomesticSource(winget.env);
    return { ok: true, installed: true, winget, register, install, mirror, env: winget.env };
  }

  const mirror = await ensureWingetDomesticSource(winget.env);
  return { ok: true, installed: false, winget, mirror, env: winget.env };
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
    `$entry = ${psString(binPath)}.Trim().TrimEnd('\\')`,
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
    '  try {',
    "  $signature = '[DllImport(\"user32.dll\", SetLastError=true, CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);'",
    '    Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition $signature -ErrorAction Stop',
    '  $sendResult = [UIntPtr]::Zero',
    "  [Win32.NativeMethods]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 0x2, 5000, [ref]$sendResult) | Out-Null",
    '  } catch {}',
    "  Write-Output \"added $entry\"",
    '} else {',
    "  Write-Output \"already present $entry\"",
    '}',
    "$after = [Environment]::GetEnvironmentVariable('Path', 'User')",
    '$afterParts = @()',
    'if ($after) {',
    "  $afterParts = $after -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ }",
    '}',
    '$contains = $false',
    'foreach ($part in $afterParts) {',
    "  if ($part.TrimEnd('\\').Equals($entry, [StringComparison]::OrdinalIgnoreCase)) {",
    '    $contains = $true',
    '    break',
    '  }',
    '}',
    'if (-not $contains) { throw "user Path does not contain $entry after update" }',
    'Write-Output "verified user PATH contains $entry"'
  ].join('\n');
  const result = await runPowerShell(script);
  return {
    code: result.code,
    output: result.code === 0
      ? `${result.output.trim()}\nOpen a new terminal to use codex and claude directly.`
      : `Failed to update user PATH for ${binPath}.\n${result.output}`
  };
}

async function setNpmGlobalPrefix(npmPrefix, env) {
  const target = String(npmPrefix || '').trim();
  const primary = await runCommand('npm', ['config', 'set', 'prefix', JSON.stringify(target), '--location=user'], { env });
  if (primary.code === 0) return primary;
  const fallback = await runCommand('npm', ['config', 'set', 'prefix', JSON.stringify(target)], { env });
  return {
    code: fallback.code,
    output: `${primary.output}\nFallback without --location=user:\n${fallback.output}`
  };
}

async function verifyGlobalInstall(cfg, env) {
  const lines = ['=== GLOBAL COMMAND VERIFY ==='];
  let ok = true;
  const prefix = await runCommand('npm', ['prefix', '-g'], { env });
  if (prefix.code !== 0) ok = false;
  lines.push(`npm prefix -g (${prefix.code}): ${prefix.output.trim()}`);

  for (const item of [
    { enabled: cfg.codex?.enabled, command: 'codex' },
    { enabled: cfg.claude?.enabled, command: 'claude' }
  ]) {
    if (!item.enabled) continue;
    const located = await runCommand('where', [item.command], { env });
    const version = located.code === 0 ? await runCommand(item.command, ['--version'], { env }) : { code: -1, output: 'command not found in configured PATH' };
    if (located.code !== 0 || version.code !== 0) ok = false;
    lines.push(`where ${item.command} (${located.code}): ${located.output.trim()}`);
    lines.push(`${item.command} --version (${version.code}): ${version.output.trim()}`);
  }

  lines.push('Open a new CMD/PowerShell window before running codex or claude directly.');
  return { code: ok ? 0 : 1, output: lines.join('\n') };
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

async function ensureNodeEnvironment(env = process.env, wingetStatus = null) {
  mainWindow?.webContents.send('log', '\n=== NODE ENV CHECK ===\n');
  let status = await getNodeEnvironmentStatus(env);
  mainWindow?.webContents.send('log', `node: ${status.node.ok ? status.node.output.trim() : '未检测到'}\n`);
  mainWindow?.webContents.send('log', `npm: ${status.npm.ok ? status.npm.output.trim() : '未检测到'}\n`);
  appendLog(`NODE CHECK node=${status.node.ok} npm=${status.npm.ok}`);
  if (status.ok) return status;

  mainWindow?.webContents.send('log', '\n未检测到完整 Node.js/npm 环境，开始执行 Node.js LTS 安装指令...\n');
  appendLog('NODE MISSING: installing OpenJS.NodeJS.LTS via winget');
  const winget = wingetStatus || await ensureWingetAvailable({ showDialog: true });
  if (!winget.ok) {
    return { ...status, ok: false, winget, error: `未检测到可用 winget，无法自动安装 Node.js。${winget.error || '请手动安装 Node.js LTS：https://nodejs.org/'}` };
  }

  const installArgs = [
    'install',
    '--id',
    'OpenJS.NodeJS.LTS',
    '-e',
    '--accept-package-agreements',
    '--accept-source-agreements'
  ];
  if (winget.mirror?.ok && winget.mirror?.sourceName) {
    installArgs.push('--source', winget.mirror.sourceName);
  }
  const install = await runCommand('winget', installArgs, { env: winget.env || process.env });
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
ipcMain.handle('dialog:dir', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('log:read', () => fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '');

ipcMain.handle('install:all', async (_, cfg) => {
  cfg = mergeConfig(cfg);
  writeConfig(cfg);
  fs.mkdirSync(cfg.installDir, { recursive: true });
  fs.mkdirSync(cfg.npmPrefix, { recursive: true });
  let env = { ...process.env, npm_config_prefix: cfg.npmPrefix };

  const results = [];
  const wingetStatus = await ensureWingetAvailable({ showDialog: true });
  results.push({
    code: wingetStatus.ok ? 0 : 1,
    output: wingetStatus.ok
      ? `winget 已就绪：${wingetStatus.winget.output.trim()}${wingetStatus.installed ? '\n已自动安装 winget。' : ''}${wingetStatus.registered ? '\n已注册系统中的 App Installer / winget。' : ''}${wingetStatus.mirror?.ok ? `\n已配置国内镜像源：${WINGET_USTC_SOURCE_URL}` : '\n国内镜像源不可用，已回退 winget 默认源。'}`
      : `winget 未就绪：${wingetStatus.error || '未知错误'}`
  });
  const nodeStatus = await ensureNodeEnvironment(env, wingetStatus);
  results.push({
    code: nodeStatus.ok ? 0 : -1,
    output: nodeStatus.ok
      ? `Node.js/npm 已就绪\nnode: ${nodeStatus.node.output.trim()}\nnpm: ${nodeStatus.npm.output.trim()}`
      : `Node.js/npm 未就绪：${nodeStatus.error || '未知错误'}`
  });
  if (!nodeStatus.ok) return results;
  env = { ...nodeStatus.env, npm_config_prefix: cfg.npmPrefix };

  results.push(await setNpmGlobalPrefix(cfg.npmPrefix, env));
  if (cfg.codex?.enabled) results.push(await runCommand('npm', ['install', '-g', cfg.codex.package || '@openai/codex'], { env }));
  if (cfg.claude?.enabled) results.push(await runCommand('npm', ['install', '-g', cfg.claude.package || '@anthropic-ai/claude-code'], { env }));
  const writeResult = await writeEnvFiles(cfg, { writeApiConfigs: true });
  results.push({ code: writeResult.pathResult.code, output: writeResult.pathResult.output });
  results.push(await verifyGlobalInstall(cfg, buildScanEnv(cfg, env)));
  return results;
});

async function writeEnvFiles(cfg, options = {}) {
  cfg = mergeConfig(cfg);
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
  if (options.writeApiConfigs !== false) {
    if (cfg.codex?.enabled) writeCodexCliSettings(cfg);
    if (cfg.claude?.enabled) writeClaudeSettings(cfg);
  }
  const pathResult = await ensureUserPathEntry(binPath);
  appendLog(`USER PATH ${pathResult.code === 0 ? 'OK' : 'FAILED'} ${binPath}`);
  appendLog(`WROTE env files ${envFile} ${bashFile}`);
  return { envFile, bashFile, binPath, pathResult };
}

ipcMain.handle('config:apply', async (_, cfg, tool) => {
  const merged = mergeConfig(cfg);
  writeConfig(merged);
  return { ok: true, ...writeSelectedApiConfig(merged, tool) };
});
ipcMain.handle('config:env', async (_, cfg) => {
  const merged = mergeConfig(cfg);
  writeConfig(merged);
  const result = await writeEnvFiles(merged, { writeApiConfigs: false });
  return { ok: true, ...result };
});
async function scanInstalledTools(cfg) {
  cfg = mergeConfig(cfg);
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
