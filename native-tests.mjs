// Real Obsidian regression tests. All notes, settings and plugins are isolated
// in a disposable vault/profile; the user's vault is never opened or changed.
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, copyFile, rm, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.argv[2] ? pathToFileURL(resolve(process.argv[2])).href : 'playwright');
const executable = process.env.CARRY_OVER_OBSIDIAN ?? '/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const dir = await realpath(await mkdtemp(join(tmpdir(), 'carry-over-native-')));
const vaultPath = join(dir, 'vault'), profilePath = join(dir, 'profile');
const notePath = 'Daily Notes/2099/12/2099-12-31.md';
let child, browser;
try {
  await mkdir(join(vaultPath, '.obsidian/plugins/carry-over-todos'), { recursive: true });
  await mkdir(join(vaultPath, 'Daily Notes/2099/12'), { recursive: true });
  await mkdir(profilePath);
  for (const name of ['main.js', 'manifest.json']) await copyFile(name, join(vaultPath, '.obsidian/plugins/carry-over-todos', name));
  for (const [name, value] of Object.entries({
    'community-plugins.json': ['carry-over-todos'],
    'core-plugins.json': ['daily-notes'],
    'daily-notes.json': { folder: 'Daily Notes', format: 'YYYY/MM/YYYY-MM-DD' },
    'app.json': { livePreview: true },
  })) await writeFile(join(vaultPath, '.obsidian', name), JSON.stringify(value));
  await writeFile(join(vaultPath, notePath), '## TODO\n\n- [ ] Fixture\n\n## Meetings\n\n## Notes\n');
  await writeFile(join(profilePath, 'obsidian.json'), JSON.stringify({ vaults: { c0ffee1234567890: { path: vaultPath, ts: Date.now(), open: true } } }));
  child = spawn(executable, [`--user-data-dir=${profilePath}`, '--remote-debugging-port=0', '--disable-background-timer-throttling'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const endpoint = await new Promise((accept, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(Error('Obsidian did not start: ' + output.slice(-2000))), 30000);
    const data = chunk => {
      output += String(chunk);
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(output);
      if (match) { clearTimeout(timeout); accept(match[1]); }
    };
    child.stdout.on('data', data); child.stderr.on('data', data);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', code => { clearTimeout(timeout); reject(Error('Obsidian exited: ' + code)); });
  });
  browser = await chromium.connectOverCDP(endpoint);
  let page;
  for (let i = 0; i < 100 && !page; i++) {
    page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith('app://obsidian.md/index.html'));
    if (!page) await new Promise(accept => setTimeout(accept, 100));
  }
  assert.ok(page, 'isolated Obsidian main window opened');
  await page.waitForFunction(path => window.app?.vault?.adapter?.getBasePath?.() === path && window.app?.plugins?.plugins?.['carry-over-todos'], vaultPath);
  await page.evaluate(async ({ vaultPath, notePath }) => {
    if (app.vault.adapter.getBasePath() !== vaultPath) throw Error('Refusing to test outside the disposable vault');
    await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath(notePath), { state: { mode: 'source', source: false } });
  }, { vaultPath, notePath });
  const note = body => `## TODO\n\n${body}\n\n## Meetings\n\n## Notes\nEnd`;
  async function reset(text) {
    await page.evaluate(({ text, vaultPath }) => {
      if (app.vault.adapter.getBasePath() !== vaultPath) throw Error('Wrong vault');
      const editor = app.workspace.activeLeaf.view.editor;
      editor.setValue(text); editor.setCursor({ line: editor.lastLine(), ch: 0 });
      editor.scrollIntoView({ from: { line: 2, ch: 0 }, to: { line: 2, ch: 0 } }, true);
    }, { text, vaultPath });
    await page.waitForTimeout(100);
  }
  async function click(name, completed = false) {
    await page.evaluate(({ name, completed }) => {
      const editor = app.workspace.activeLeaf.view.editor;
      const line = editor.getValue().split('\n').findIndex(text => text.endsWith('] ' + name) && (completed ? text.startsWith('>') : !text.startsWith('>')));
      if (line >= 0) editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
    }, { name, completed });
    await page.waitForTimeout(80);
    const collapsed = page.locator('.cm-callout .callout.is-collapsed');
    if (completed && await collapsed.count()) await collapsed.locator('.callout-title').click();
    const handle = await page.evaluateHandle(({ name, completed }) => {
      const cm = app.workspace.activeLeaf.view.editor.cm;
      return [...document.querySelectorAll('.markdown-source-view input.task-list-item-checkbox')].find(input => {
        const callout = input.closest('.cm-callout');
        if (!!callout !== completed) return false;
        const base = cm.state.doc.lineAt(cm.posAtDOM(callout || input)).number;
        return cm.state.doc.line(base + (callout ? Number(input.dataset.line) : 0)).text.endsWith('] ' + name);
      });
    }, { name, completed });
    assert.ok(handle.asElement(), 'native checkbox exists for ' + name);
    await handle.asElement().click();
    // Include browser activation rollback and any host deferred DOM work.
    await page.waitForTimeout(80);
  }
  async function verify() {
    const state = await page.evaluate(() => {
      const cm = app.workspace.activeLeaf.view.editor.cm;
      const checks = [...document.querySelectorAll('.markdown-source-view input.task-list-item-checkbox')].map(input => {
        const callout = input.closest('.cm-callout');
        const base = cm.state.doc.lineAt(cm.posAtDOM(callout || input)).number;
        const source = cm.state.doc.line(base + (callout ? Number(input.dataset.line) : 0)).text;
        return { source, checked: input.checked, expected: /\[([xX])\]/.test(source) };
      });
      return { text: cm.state.doc.toString(), checks };
    });
    assert.ok(state.checks.every(check => check.checked === check.expected), JSON.stringify(state.checks));
    return state.text;
  }
  await reset(note('- [ ] Parent\n  - [ ] Only child'));
  for (let i = 0; i < 4; i++) {
    await click('Only child');
    const text = await verify();
    assert.ok(text.includes(i % 2 === 0 ? '- [x] Only child' : '- [ ] Only child'));
  }
  const beforeReload = await verify();
  await page.evaluate(async () => {
    document.querySelector('.markdown-source-view input.task-list-item-checkbox').checked = true;
    await app.plugins.disablePlugin('carry-over-todos');
    await app.plugins.enablePlugin('carry-over-todos');
  });
  await page.waitForTimeout(80);
  assert.equal(await verify(), beforeReload, 'reload repairs stale UI without changing Markdown');
  await reset(note('- [ ] Parent\n  - [ ] First\n  - [x] Last'));
  for (const name of ['First', 'First', 'Last', 'Last']) { await click(name); await verify(); }
  await reset(note('- [ ] Alpha\n  - [x] Child\n- [ ] Bravo\n- [ ] Charlie\n\n> [!done]- Completed\n> - [x] Older'));
  for (const name of ['Alpha', 'Bravo']) { await click(name); await verify(); }
  for (const name of ['Alpha', 'Bravo']) {
    await click(name, true);
    const text = await verify();
    assert.ok(text.includes('- [ ] ' + name)); assert.ok(!text.includes('> - [x] ' + name));
  }
  console.log('Native Obsidian regressions passed: stationary toggles, sibling boundaries and Completed round trips.');
} finally {
  await browser?.close();
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise(accept => { child.once('exit', accept); setTimeout(accept, 3000); });
  }
  await rm(dir, { recursive: true, force: true });
}
