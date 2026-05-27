const fs = require('fs');
const os = require('os');
const path = require('path');

function trimOutput(output) {
  return String(output || '').trim();
}

function firstOutputLine(result, fallback = '') {
  const output = trimOutput(result && result.output);
  return output ? output.split(/\r?\n/)[0].trim() : fallback;
}

function pathKeyFor(env) {
  return Object.keys(env || {}).find(k => k.toLowerCase() === 'path') || 'PATH';
}

function prependPathEntries(baseEnv, entries) {
  const env = { ...(baseEnv || {}) };
  const pathKey = pathKeyFor(env);
  const currentPath = env[pathKey] || '';
  const parts = String(currentPath || '').split(path.delimiter).filter(Boolean);
  const seen = new Set(parts.map(p => p.toLowerCase()));
  const prefix = [];
  for (const entry of entries) {
    const value = String(entry || '').trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    prefix.push(value);
    seen.add(key);
  }
  env[pathKey] = [...prefix, ...parts].join(path.delimiter);
  for (const key of Object.keys(env)) {
    if (key !== pathKey && key.toLowerCase() === 'path') delete env[key];
  }
  return env;
}

function buildToolStatus(name, versionResult, pathResult) {
  const output = trimOutput(versionResult && versionResult.output);
  const code = Number.isInteger(versionResult && versionResult.code) ? versionResult.code : -1;
  const installed = code === 0;
  const installPath = installed ? firstOutputLine(pathResult, '已安装，未能定位路径') : '未检测到';
  return {
    name,
    installed,
    version: installed && output ? output.split(/\r?\n/)[0].trim() : '未安装或不可用',
    installPath,
    code,
    output
  };
}

function buildScanEnv(cfg, baseEnv = process.env) {
  const npmPrefix = cfg && cfg.npmPrefix ? cfg.npmPrefix : '';
  const commonNodeDirs = process.platform === 'win32' ? ['C:\\Program Files\\nodejs'] : [];
  return prependPathEntries(baseEnv, [npmPrefix, ...commonNodeDirs]);
}

function escapeSh(value) {
  return String(value || '').replace(/'/g, `'"'"'`);
}

function buildProxyEnvLines(cfg) {
  const cmd = [
    cfg.codex?.baseUrl ? `set "OPENAI_BASE_URL=${cfg.codex.baseUrl}"` : '',
    cfg.codex?.apiKey ? `set "OPENAI_API_KEY=${cfg.codex.apiKey}"` : '',
    cfg.claude?.baseUrl ? `set "ANTHROPIC_BASE_URL=${cfg.claude.baseUrl}"` : '',
    cfg.claude?.apiKey ? `set "ANTHROPIC_API_KEY=${cfg.claude.apiKey}"` : ''
  ].filter(Boolean).join('\r\n');
  const sh = [
    cfg.codex?.baseUrl ? `export OPENAI_BASE_URL='${escapeSh(cfg.codex.baseUrl)}'` : '',
    cfg.codex?.apiKey ? `export OPENAI_API_KEY='${escapeSh(cfg.codex.apiKey)}'` : '',
    cfg.claude?.baseUrl ? `export ANTHROPIC_BASE_URL='${escapeSh(cfg.claude.baseUrl)}'` : '',
    cfg.claude?.apiKey ? `export ANTHROPIC_API_KEY='${escapeSh(cfg.claude.apiKey)}'` : ''
  ].filter(Boolean).join('\n');
  return { cmd, sh };
}

function normalizeProxyProfile(profile) {
  return {
    name: String(profile?.name || '').trim(),
    codexBaseUrl: String(profile?.codexBaseUrl || '').trim(),
    codexApiKey: String(profile?.codexApiKey || ''),
    claudeBaseUrl: String(profile?.claudeBaseUrl || '').trim(),
    claudeApiKey: String(profile?.claudeApiKey || '')
  };
}

function normalizeProxyProfiles(profiles) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(profiles) ? profiles : []) {
    const p = normalizeProxyProfile(item);
    if (!p.name || seen.has(p.name)) continue;
    seen.add(p.name);
    out.push(p);
  }
  return out;
}

function applyProxyProfileToConfig(cfg, profile) {
  const p = normalizeProxyProfile(profile);
  return {
    ...cfg,
    activeProxyProfile: p.name,
    codex: { ...(cfg.codex || {}), baseUrl: p.codexBaseUrl, apiKey: p.codexApiKey },
    claude: { ...(cfg.claude || {}), baseUrl: p.claudeBaseUrl, apiKey: p.claudeApiKey }
  };
}

function upsertProxyProfile(profiles, profile) {
  const p = normalizeProxyProfile(profile);
  if (!p.name) return normalizeProxyProfiles(profiles);
  const current = normalizeProxyProfiles(profiles).filter(x => x.name !== p.name);
  current.push(p);
  return current;
}

function removeProxyProfile(profiles, name) {
  const target = String(name || '').trim();
  return normalizeProxyProfiles(profiles).filter(p => p.name !== target);
}

function buildClaudeSettings(existingSettings, cfg) {
  const settings = { ...(existingSettings && typeof existingSettings === 'object' ? existingSettings : {}) };
  const env = { ...(settings.env && typeof settings.env === 'object' ? settings.env : {}) };
  if (cfg.claude?.baseUrl) env.ANTHROPIC_BASE_URL = cfg.claude.baseUrl;
  if (cfg.claude?.apiKey) {
    env.ANTHROPIC_API_KEY = cfg.claude.apiKey;
    env.ANTHROPIC_AUTH_TOKEN = cfg.claude.apiKey;
  }
  settings.env = env;
  return settings;
}

function nowStamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function backupFile(file) {
  if (!fs.existsSync(file)) return null;
  const backup = `${file}.bak.${nowStamp()}`;
  fs.copyFileSync(file, backup);
  return backup;
}

function tomlQuote(value) {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function removeCodexProviderSection(text, provider) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  const headers = new Set([`[model_providers.${provider}]`, `[model_providers."${provider}"]`]);
  for (let i = 0; i < lines.length;) {
    const stripped = lines[i].trim();
    if (headers.has(stripped)) {
      i += 1;
      while (i < lines.length) {
        const s = lines[i].trimStart();
        if (s.startsWith('[') && s.trimEnd().endsWith(']')) break;
        i += 1;
      }
      continue;
    }
    out.push(lines[i]);
    i += 1;
  }
  return out.join('\n').trimEnd() + (out.length ? '\n' : '');
}

function setOrPrependRootKey(text, key, valueLiteral) {
  const lines = String(text || '').split(/\r?\n/).filter((line, idx, arr) => !(idx === arr.length - 1 && line === ''));
  if (!lines.length) return `${key} = ${valueLiteral}\n`;
  const out = [];
  let beforeFirstTable = true;
  let replaced = false;
  let inserted = false;
  const isExactRootKey = line => {
    const stripped = line.trimStart();
    if (!stripped || stripped.startsWith('#') || !stripped.includes('=')) return false;
    return stripped.split('=', 1)[0].trim() === key;
  };
  for (const line of lines) {
    const stripped = line.trimStart();
    if (beforeFirstTable && stripped.startsWith('[')) {
      if (!replaced && !inserted) {
        out.push(`${key} = ${valueLiteral}`);
        inserted = true;
      }
      beforeFirstTable = false;
    }
    if (beforeFirstTable && isExactRootKey(line)) {
      out.push(`${key} = ${valueLiteral}`);
      replaced = true;
    } else {
      out.push(line);
    }
  }
  if (beforeFirstTable && !replaced && !inserted) out.push(`${key} = ${valueLiteral}`);
  return out.join('\n').trimEnd() + '\n';
}

function codexHomeCandidates(env = process.env) {
  const raw = [];
  if (env.CODEX_HOME) raw.push(path.join(env.CODEX_HOME, 'config.toml'));
  if (env.OPENAI_CODEX_HOME) raw.push(path.join(env.OPENAI_CODEX_HOME, 'config.toml'));
  for (const home of [env.USERPROFILE, env.HOME, os.homedir()].filter(Boolean)) raw.push(path.join(home, '.codex', 'config.toml'));
  if (env.APPDATA) {
    raw.push(path.join(env.APPDATA, 'Codex', 'config.toml'));
    raw.push(path.join(env.APPDATA, 'codex', 'config.toml'));
  }
  if (env.LOCALAPPDATA) {
    raw.push(path.join(env.LOCALAPPDATA, 'Codex', 'config.toml'));
    raw.push(path.join(env.LOCALAPPDATA, 'codex', 'config.toml'));
  }
  const seen = new Set();
  return raw.map(p => path.resolve(p)).filter(p => {
    const k = p.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function findCodexConfigTargets(env = process.env) {
  const candidates = codexHomeCandidates(env);
  const existing = candidates.filter(p => fs.existsSync(p));
  if (existing.length) return existing;
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return [path.join(home, '.codex', 'config.toml')];
}

function writeCodexProxyConfig(configPath, cfg) {
  const codex = cfg.codex || {};
  const provider = String(codex.provider || 'rightcode').trim() || 'rightcode';
  const model = String(codex.model || 'gpt-5.5').trim() || 'gpt-5.5';
  const baseUrl = String(codex.baseUrl || '').trim();
  if (!baseUrl) throw new Error('Codex Base URL 不能为空');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  let text = '';
  if (fs.existsSync(configPath)) {
    text = fs.readFileSync(configPath, 'utf8');
    backupFile(configPath);
  }
  text = removeCodexProviderSection(text, provider);
  text = setOrPrependRootKey(text, 'model_provider', tomlQuote(provider));
  text = setOrPrependRootKey(text, 'model', tomlQuote(model));
  text = `${text.trimEnd()}\n\n[model_providers.${provider}]\nname = ${tomlQuote(provider)}\nbase_url = ${tomlQuote(baseUrl)}\nwire_api = "responses"\nrequires_openai_auth = true\n`;
  fs.writeFileSync(configPath, text, 'utf8');
  return { configPath, provider, model, baseUrl };
}

function writeCodexAuthConfig(configPath, cfg) {
  const apiKey = String((cfg.codex || {}).apiKey || '');
  const authPath = path.join(path.dirname(configPath), 'auth.json');
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  let data = {};
  if (fs.existsSync(authPath)) {
    backupFile(authPath);
    try {
      const parsed = JSON.parse(fs.readFileSync(authPath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
    } catch { data = {}; }
  }
  const existingKey = typeof data.OPENAI_API_KEY === 'string' ? data.OPENAI_API_KEY : '';
  const finalKey = apiKey || existingKey;
  data.auth_mode = 'apikey';
  if (finalKey) data.OPENAI_API_KEY = finalKey;
  else delete data.OPENAI_API_KEY;
  fs.writeFileSync(authPath, JSON.stringify(data, null, 2), 'utf8');
  return authPath;
}

function verifyCodexConfig(configPath, cfg) {
  const codex = cfg.codex || {};
  const provider = String(codex.provider || 'rightcode').trim() || 'rightcode';
  const model = String(codex.model || 'gpt-5.5').trim() || 'gpt-5.5';
  const baseUrl = String(codex.baseUrl || '').trim();
  const text = fs.readFileSync(configPath, 'utf8');
  const missing = [];
  if (!text.includes(`model_provider = "${provider}"`)) missing.push('model_provider');
  if (!text.includes(`model = "${model}"`)) missing.push('model');
  if (!text.includes(`base_url = "${baseUrl}"`)) missing.push('base_url');
  if (!text.includes('wire_api = "responses"')) missing.push('wire_api');
  return { ok: missing.length === 0, message: missing.length ? `config.toml 校验失败：${missing.join(', ')}` : 'config.toml 已写入并读回校验成功' };
}

function verifyCodexAuth(configPath, cfg) {
  const apiKey = String((cfg.codex || {}).apiKey || '');
  const authPath = path.join(path.dirname(configPath), 'auth.json');
  const data = JSON.parse(fs.readFileSync(authPath, 'utf8'));
  if (data.auth_mode !== 'apikey') return { ok: false, message: 'auth_mode 未匹配 apikey' };
  if (apiKey && data.OPENAI_API_KEY !== apiKey) return { ok: false, message: 'OPENAI_API_KEY 未匹配' };
  if (!data.OPENAI_API_KEY) return { ok: false, message: 'OPENAI_API_KEY 不存在；请填写 Codex API Key 或保留既有 key' };
  return { ok: true, message: apiKey ? 'auth.json API Key 已写入并读回校验成功' : 'auth.json 已保留既有 API Key，并修正 auth_mode' };
}

function writeCodexSettings(cfg, env = process.env) {
  const targets = findCodexConfigTargets(env);
  return targets.map(configPath => {
    const written = writeCodexProxyConfig(configPath, cfg);
    const authPath = writeCodexAuthConfig(configPath, cfg);
    const configCheck = verifyCodexConfig(configPath, cfg);
    const authCheck = verifyCodexAuth(configPath, cfg);
    return { ...written, authPath, ok: configCheck.ok && authCheck.ok, configMessage: configCheck.message, authMessage: authCheck.message };
  });
}

module.exports = {
  buildToolStatus,
  buildScanEnv,
  buildProxyEnvLines,
  normalizeProxyProfiles,
  applyProxyProfileToConfig,
  upsertProxyProfile,
  removeProxyProfile,
  buildClaudeSettings,
  findCodexConfigTargets,
  writeCodexSettings,
  verifyCodexConfig,
  verifyCodexAuth
};
