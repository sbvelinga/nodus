import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import ts from 'typescript';

// Execute the real main-process update handlers with fake OS/updater boundaries.
// No downloads, app replacement, quit or restart can reach the host running tests.
const source = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const functions = ['setupAutoUpdates', 'installDownloadedUpdate', 'checkForUpdates', 'emitUpdate', 'discardPendingPrereleaseUpdate', 'configureUpdateChannel'];
const code = ts.transpileModule(ast.statements.filter((n) => ts.isFunctionDeclaration(n) && functions.includes(n.name?.text)).map((n) => n.getText(ast)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function harness({ platform = 'win32', signed = true, recovery = false, beta = false, backup = async () => ({ ok: true, path: 'verified-backup' }) } = {}) {
  const updater = new EventEmitter();
  const events = [], timers = [], installs = [], copies = [];
  updater.quitAndInstall = (...args) => installs.push(['native', ...args]);
  const settings = { betaUpdates: beta };
  const ctx = { console: { log() {}, warn() {}, error() {} }, process: { platform, env: {} }, app: { isPackaged: true, getVersion: () => '5.1.7' },
    autoUpdater: updater, mainWindow: { webContents: { send: (_channel, event) => events.push(event) } },
    macAppHasDeveloperIdSignature: () => signed, getSettings: () => settings,
    hasConfiguredRecoveryFolder: () => recovery, hasUsableRecoverySetup: () => recovery,
    applyUpdateChannel: (_updater, enabled) => enabled ? 'beta' : 'latest',
    isPrereleaseVersion: (version) => version?.includes('-beta'),
    runPreUpdateBackupNow: async (...args) => { copies.push(args); return backup(); },
    installUnsignedMacUpdate: async (file) => installs.push(['unsigned-mac', file]),
    setInterval: () => 1, setTimeout: (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; }, clearTimeout: (timer) => { timer.cancelled = true; },
    refreshAnnouncements() {}, availableUpdateVersion: () => null,
    UPDATE_CHECK_INTERVAL_MS: 60_000, ANNOUNCEMENTS_STARTUP_DELAY_MS: 3000, UPDATE_PROGRESS_MIN_INTERVAL_MS: 500,
    installingUpdate: false, downloadedUpdateVersion: null, downloadedUpdateFile: null, activeUpdateVersion: null,
    activeUpdateCancellationToken: null, lastUpdateEvent: null, installUpdateTimer: null, useUnsignedMacUpdaterFallback: false,
    lastDownloadProgressEmitAt: 0, lastDownloadProgressPercent: -1,
  };
  vm.createContext(ctx); vm.runInContext(code, ctx); ctx.setupAutoUpdates();
  const downloaded = (version = beta ? '5.2.0-beta.1' : '5.2.0') => {
    updater.emit('update-available', { version }); updater.emit('update-downloaded', { version, downloadedFile: 'verified.zip' });
  };
  const finish = async () => { for (const timer of timers.filter((t) => t.delay === 650 && !t.cancelled)) timer.fn(); await new Promise((r) => setImmediate(r)); };
  return { ctx, updater, settings, events, timers, installs, copies, downloaded, finish };
}

for (const platform of ['win32', 'linux', 'darwin']) for (const recovery of [false, true]) {
  test(`${platform}, Recovery ${recovery}: download never restarts or installs on quit; explicit install works`, async () => {
    const h = harness({ platform, recovery, signed: platform !== 'darwin' }); h.downloaded();
    assert.equal(h.updater.autoInstallOnAppQuit, false);
    assert.equal(h.timers.some((t) => t.delay === 1200 || t.delay === 650), false);
    assert.equal(h.events.at(-1).downloadedVersion, '5.2.0');
    assert.equal(h.events.at(-1).status, 'downloaded'); assert.deepEqual(h.installs, []);
    const status = await h.ctx.checkForUpdates('manual');
    assert.equal(status.status, 'downloaded', 'revisiting the update section retains the candidate');
    assert.deepEqual(h.copies, [], 'postponing does not start a backup or installation');
    await h.ctx.installDownloadedUpdate(); await h.finish();
    assert.equal(h.installs.length, 1); assert.equal(h.copies.length, recovery ? 1 : 0);
    assert.equal(h.updater.autoInstallOnAppQuit, false);
  });
}

test('signed macOS uses the native installer only on explicit action', async () => {
  const h = harness({ platform: 'darwin', signed: true }); h.downloaded();
  assert.equal(h.updater.autoInstallOnAppQuit, false); await h.ctx.installDownloadedUpdate(); await h.finish();
  assert.equal(h.installs[0][0], 'native');
});

test('late download/check events cannot erase a ready update', () => {
  const h = harness(); h.downloaded();
  h.updater.emit('update-not-available', { version: '5.1.7' });
  h.updater.emit('download-progress', { percent: 17 });
  h.updater.emit('update-available', { version: '5.1.8' });
  assert.equal(h.ctx.lastUpdateEvent.status, 'downloaded'); assert.equal(h.ctx.lastUpdateEvent.downloadedVersion, '5.2.0');
});

test('a beta without Recovery stays downloaded and cannot install', async () => {
  const h = harness({ beta: true }); h.downloaded(); const result = await h.ctx.installDownloadedUpdate(); await h.finish();
  assert.equal(result.errorCode, 'pre-update-backup-required'); assert.equal(result.downloadedVersion, '5.2.0-beta.1');
  assert.equal(h.ctx.installingUpdate, false); assert.deepEqual(h.installs, []);
});

for (const throws of [false, true]) test(`failed beta backup (${throws ? 'exception' : 'result'}) retains a retryable download`, async () => {
  const h = harness({ beta: true, recovery: true, backup: async () => { if (throws) throw new Error('disk failure'); return { ok: false, message: 'verification failed' }; } });
  h.downloaded(); const result = await h.ctx.installDownloadedUpdate(); await h.finish();
  assert.equal(result.errorCode, 'pre-update-backup-failed'); assert.ok(result.downloadedVersion);
  assert.equal(h.ctx.installingUpdate, false); assert.deepEqual(h.installs, []);
  h.ctx.runPreUpdateBackupNow = async () => ({ ok: true, path: 'verified' });
  await h.ctx.installDownloadedUpdate(); await h.finish(); assert.equal(h.installs.length, 1);
});

test('stable backup failure preserves the existing non-blocking policy', async () => {
  const h = harness({ recovery: true, backup: async () => { throw new Error('disk failure'); } }); h.downloaded();
  await h.ctx.installDownloadedUpdate(); await h.finish(); assert.equal(h.installs.length, 1);
});

test('concurrent clicks and checks do not bypass or duplicate the backup', async () => {
  let resolve;
  const h = harness({ beta: true, recovery: true, backup: () => new Promise((r) => { resolve = r; }) }); h.downloaded();
  const first = h.ctx.installDownloadedUpdate();
  assert.equal((await h.ctx.installDownloadedUpdate()).status, 'backing-up');
  assert.equal((await h.ctx.checkForUpdates('scheduled')).status, 'backing-up');
  assert.equal(h.copies.length, 1); assert.deepEqual(h.installs, []);
  resolve({ ok: true, path: 'verified' }); await first; await h.finish(); assert.equal(h.installs.length, 1);
});

test('opting out of beta during backup cancels installation and clears the pending indicator', async () => {
  let resolve;
  const h = harness({ beta: true, recovery: true, backup: () => new Promise((r) => { resolve = r; }) }); h.downloaded();
  const pending = h.ctx.installDownloadedUpdate(); h.settings.betaUpdates = false;
  h.ctx.configureUpdateChannel(false, 'test'); resolve({ ok: true, path: 'verified' });
  await pending; await h.finish(); assert.equal(h.ctx.lastUpdateEvent.downloadedVersion, null); assert.deepEqual(h.installs, []);
});

test('installer failures retain the candidate and expose a translatable code', async () => {
  const h = harness(); h.downloaded(); h.updater.quitAndInstall = () => { throw new Error('OS failure'); };
  await h.ctx.installDownloadedUpdate(); await h.finish();
  assert.equal(h.ctx.lastUpdateEvent.errorCode, 'update-install-failed'); assert.equal(h.ctx.lastUpdateEvent.downloadedVersion, '5.2.0');
  assert.equal(h.ctx.installingUpdate, false);
});
