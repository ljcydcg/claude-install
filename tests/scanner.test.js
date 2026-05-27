const assert = require('assert');
const { addPathEntries, buildNpmGlobalBinPath, buildToolStatus, buildScanEnv, buildProxyEnvLines, buildClaudeSettings } = require('../src/scanner');

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
}

run();
console.log('scanner.test.js passed');
