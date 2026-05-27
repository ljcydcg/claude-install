const assert = require('assert');
const { buildToolStatus, buildScanEnv, buildProxyEnvLines, normalizeProxyProfiles, applyProxyProfileToConfig, upsertProxyProfile, removeProxyProfile, buildClaudeSettings } = require('../src/scanner');

function run() {
  const installed = buildToolStatus('codex', { code: 0, output: 'codex-cli 1.2.3\n' }, { code: 0, output: 'D:\\ai-cli-tools\\npm-global\\codex.cmd\n' });
  assert.deepStrictEqual(installed, {
    name: 'codex',
    installed: true,
    version: 'codex-cli 1.2.3',
    installPath: 'D:\\ai-cli-tools\\npm-global\\codex.cmd',
    code: 0,
    output: 'codex-cli 1.2.3'
  });

  const missing = buildToolStatus('claude', { code: 1, output: 'command not found: claude\n' });
  assert.strictEqual(missing.name, 'claude');
  assert.strictEqual(missing.installed, false);
  assert.strictEqual(missing.version, '未安装或不可用');
  assert.strictEqual(missing.installPath, '未检测到');
  assert.strictEqual(missing.output, 'command not found: claude');

  const lines = buildProxyEnvLines({
    codex: { baseUrl: 'https://proxy.example/v1', apiKey: 'sk-codex' },
    claude: { baseUrl: 'https://proxy.example/anthropic', apiKey: 'sk-claude' }
  });
  assert.ok(lines.cmd.includes('set "OPENAI_BASE_URL=https://proxy.example/v1"'));
  assert.ok(lines.cmd.includes('set "ANTHROPIC_BASE_URL=https://proxy.example/anthropic"'));
  assert.ok(lines.sh.includes("export OPENAI_API_KEY='sk-codex'"));
  assert.ok(lines.sh.includes("export ANTHROPIC_API_KEY='sk-claude'"));

  const profiles = normalizeProxyProfiles([
    { name: '本机', codexBaseUrl: 'http://localhost:3000/v1', codexApiKey: 'k1', claudeBaseUrl: '', claudeApiKey: '' },
    { name: '本机', codexBaseUrl: 'https://duplicate/v1' },
    { name: '', codexBaseUrl: 'https://ignored/v1' }
  ]);
  assert.deepStrictEqual(profiles, [
    { name: '本机', codexBaseUrl: 'http://localhost:3000/v1', codexApiKey: 'k1', claudeBaseUrl: '', claudeApiKey: '' }
  ]);

  const cfg = applyProxyProfileToConfig({ codex: {}, claude: {} }, {
    name: '中转A', codexBaseUrl: 'https://a.example/v1', codexApiKey: 'oa', claudeBaseUrl: 'https://a.example/anthropic', claudeApiKey: 'ak'
  });
  assert.strictEqual(cfg.activeProxyProfile, '中转A');
  assert.strictEqual(cfg.codex.baseUrl, 'https://a.example/v1');
  assert.strictEqual(cfg.codex.apiKey, 'oa');
  assert.strictEqual(cfg.claude.baseUrl, 'https://a.example/anthropic');
  assert.strictEqual(cfg.claude.apiKey, 'ak');

  const updated = upsertProxyProfile([], { name: '中转A', codexBaseUrl: 'https://new/v1' });
  assert.strictEqual(updated.length, 1);
  assert.strictEqual(updated[0].codexBaseUrl, 'https://new/v1');
  assert.deepStrictEqual(removeProxyProfile(updated, '中转A'), []);

  const env = buildScanEnv({ npmPrefix: 'D:\\ai-cli-tools\\npm-global' }, { PATH: 'C:\\Windows\\System32' });
  assert.ok(env.PATH.startsWith('D:\\ai-cli-tools\\npm-global;'));
  assert.ok(env.PATH.includes('C:\\Program Files\\nodejs'));
  assert.ok(env.PATH.includes('C:\\Windows\\System32'));

  const envWithPathKey = buildScanEnv({ npmPrefix: 'D:\\ai-cli-tools\\npm-global' }, { Path: 'C:\\Windows\\System32' });
  assert.ok(envWithPathKey.Path.startsWith('D:\\ai-cli-tools\\npm-global;'));
  assert.ok(envWithPathKey.Path.includes('C:\\Program Files\\nodejs'));
  assert.strictEqual(Object.prototype.hasOwnProperty.call(envWithPathKey, 'PATH'), false);

  const claudeSettings = buildClaudeSettings({ theme: 'dark', env: { OLD: 'keep' } }, {
    claude: { baseUrl: 'https://proxy.example/anthropic', apiKey: 'sk-claude-real' }
  });
  assert.strictEqual(claudeSettings.theme, 'dark');
  assert.strictEqual(claudeSettings.env.OLD, 'keep');
  assert.strictEqual(claudeSettings.env.ANTHROPIC_BASE_URL, 'https://proxy.example/anthropic');
  assert.strictEqual(claudeSettings.env.ANTHROPIC_API_KEY, 'sk-claude-real');
  assert.strictEqual(claudeSettings.env.ANTHROPIC_AUTH_TOKEN, 'sk-claude-real');
}

run();
console.log('scanner.test.js passed');
