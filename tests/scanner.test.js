const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { addPathEntries, buildNpmGlobalBinPath, buildToolStatus, buildScanEnv, buildProxyEnvLines, buildClaudeSettings, writeCodexSettings } = require('../src/scanner');

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

  const env = buildScanEnv({ npmPrefix: 'D:\\ai-cli-tools\\npm-global' }, { PATH: 'C:\\Windows\\System32' });
  assert.ok(env.PATH.startsWith('D:\\ai-cli-tools\\npm-global;'));
  assert.ok(env.PATH.includes('C:\\Program Files\\nodejs'));
  assert.ok(env.PATH.includes('C:\\Windows\\System32'));

  const envWithPathKey = buildScanEnv({ npmPrefix: 'D:\\ai-cli-tools\\npm-global' }, { Path: 'C:\\Windows\\System32' });
  assert.ok(envWithPathKey.Path.startsWith('D:\\ai-cli-tools\\npm-global;'));
  assert.ok(envWithPathKey.Path.includes('C:\\Program Files\\nodejs'));
  assert.strictEqual(Object.prototype.hasOwnProperty.call(envWithPathKey, 'PATH'), false);

  assert.strictEqual(buildNpmGlobalBinPath('D:\\ai-cli-tools\\npm-global\\'), 'D:\\ai-cli-tools\\npm-global');
  assert.strictEqual(
    addPathEntries('C:\\Windows\\System32;D:\\ai-cli-tools\\npm-global', ['D:\\ai-cli-tools\\npm-global\\', 'C:\\Tools']),
    'C:\\Windows\\System32;D:\\ai-cli-tools\\npm-global;C:\\Tools'
  );

  const claudeSettings = buildClaudeSettings({ theme: 'dark', env: { OLD: 'keep' } }, {
    claude: { baseUrl: 'https://proxy.example/anthropic', apiKey: 'sk-claude-real' }
  });
  assert.strictEqual(claudeSettings.theme, 'dark');
  assert.strictEqual(claudeSettings.env.OLD, 'keep');
  assert.strictEqual(claudeSettings.env.ANTHROPIC_BASE_URL, 'https://proxy.example/anthropic');
  assert.strictEqual(claudeSettings.env.ANTHROPIC_API_KEY, 'sk-claude-real');
  assert.strictEqual(claudeSettings.env.ANTHROPIC_AUTH_TOKEN, 'sk-claude-real');

  const customClaudeSettings = buildClaudeSettings({}, {
    claude: {
      baseUrl: 'https://custom.example/anthropic',
      apiKey: 'sk-custom',
      configTemplate: '{ "env": { "ANTHROPIC_BASE_URL": "{{baseUrl}}", "CUSTOM_TOKEN": "{{apiKey}}" }, "permissions": { "allow": ["Bash(node --version)"] } }'
    }
  });
  assert.strictEqual(customClaudeSettings.env.ANTHROPIC_BASE_URL, 'https://custom.example/anthropic');
  assert.strictEqual(customClaudeSettings.env.CUSTOM_TOKEN, 'sk-custom');
  assert.deepStrictEqual(customClaudeSettings.permissions.allow, ['Bash(node --version)']);

  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-template-test-'));
  try {
    const written = writeCodexSettings({
      codex: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'sk-codex-template',
        configTemplate: '[model_providers.{{provider}}]\nname = "{{provider}}"\nbase_url = "{{baseUrl}}"\nwire_api = "chat"\nrequires_openai_auth = true\n'
      }
    }, { CODEX_HOME: codexHome, USERPROFILE: codexHome });
    assert.strictEqual(written.length, 1);
    assert.strictEqual(written[0].ok, true);
    const text = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
    assert.ok(text.includes('model_provider = "deepseek"'));
    assert.ok(text.includes('model = "deepseek-chat"'));
    assert.ok(text.includes('wire_api = "chat"'));
    assert.ok(text.includes('base_url = "https://api.deepseek.com"'));
  } finally {
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
}

run();
console.log('scanner.test.js passed');
