import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';
// Optional argument allows using a preinstalled browser-automation runtime.
const { chromium } = await import(process.argv[2] ? pathToFileURL(resolve(process.argv[2])).href : 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'carry-over-browser-'));
let browser;
try {
  const outfile = join(dir, 'fixture.js');
  await esbuild.build({ entryPoints: ['browser-fixture.ts'], bundle: true, outfile, format: 'iife', target: 'es2020', plugins: [{ name: 'mock-obsidian', setup(build) { build.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve('obsidian-test-stub.ts') })); } }] });
  browser = await chromium.launch({ headless: true, ...(process.env.CARRY_OVER_CHROME ? { executablePath: process.env.CARRY_OVER_CHROME } : {}) });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error));
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ path: outfile });
  const note = body => `## TODO\n\n${body}\n\n## Meetings\n\n## Notes\nKeep me`;
  const initial = note('- [ ] Alpha\n  - [x] Alpha child\n- [ ] Bravo\n- [ ] Charlie');
  const snapshot = () => page.evaluate(() => window.snapshot());
  const liveClick = name => page.locator('.cm-line').filter({ hasText: new RegExp(name + '$') }).locator('input').click();
  const doneClick = name => page.locator('.cm-callout label').filter({ hasText: new RegExp(name + '$') }).locator('input').click();
  async function verify() {
    const state = await snapshot();
    assert.ok(state.checks.every(check => check.correct), JSON.stringify(state.checks));
    return state;
  }
  // The old synchronous filter allows the browser-toggled DOM to be reused
  // for the unchecked row below it. This assertion proves the reproduction.
  await page.evaluate(text => window.mount(text, false), initial);
  await liveClick('Alpha');
  const old = await snapshot();
  assert.ok(old.text.includes('- [ ] Bravo'));
  assert.ok(old.checks.some(check => !check.correct), 'old behavior must reproduce a wrong visible checkbox');

  await page.evaluate(text => window.mount(text), initial);
  await liveClick('Alpha');
  let state = await verify();
  assert.equal(state.nativeCalls, 0, 'native input/callout handlers must not apply a second toggle');
  assert.equal(state.undoDepth, 1);
  assert.ok(state.text.includes('> - [x] Alpha\n>   - [x] Alpha child'));
  assert.ok(state.text.includes('- [ ] Bravo\n- [ ] Charlie'));
  await doneClick('Alpha');
  state = await verify();
  assert.ok(state.text.includes('- [ ] Charlie\n- [ ] Alpha\n  - [x] Alpha child'));
  assert.ok(!state.text.includes('> - [x] Alpha'));
  await page.evaluate(() => window.undo());
  assert.ok((await verify()).text.includes('> - [x] Alpha'));
  await page.evaluate(() => window.redo());
  assert.ok((await verify()).text.includes('- [ ] Alpha'));

  // Distinct user gestures must stay distinct even inside the history delay.
  await page.evaluate(text => window.mount(text), initial);
  await liveClick('Alpha'); await liveClick('Bravo');
  state = await verify();
  assert.equal(state.undoDepth, 2, 'each user click gets its own undo step');
  assert.ok(state.text.includes('> - [x] Alpha\n>   - [x] Alpha child\n> - [x] Bravo'));
  await page.evaluate(() => window.undo());
  state = await verify();
  assert.ok(state.text.includes('> - [x] Alpha'));
  assert.ok(state.text.includes('- [ ] Bravo'));
  await page.evaluate(() => window.redo());
  await doneClick('Bravo'); await doneClick('Alpha');
  state = await verify();
  assert.ok(state.text.includes('- [ ] Charlie\n- [ ] Bravo\n- [ ] Alpha'));
  assert.equal(state.nativeCalls, 0);

  // Space on a focused checkbox uses the same single click path.
  const bravo = page.locator('.cm-line').filter({ hasText: 'Bravo' }).locator('input');
  await bravo.focus(); await page.keyboard.press('Space');
  assert.ok((await verify()).text.includes('> - [x] Bravo'));

  const nested = note('- [ ] Parent\n  - [ ] First\n    details [[link]]\n  - [ ] Second\n  - [x] Third\n- [ ] Other');
  await page.evaluate(text => window.mount(text), nested);
  await liveClick('First');
  state = await verify();
  assert.ok(state.text.includes('  - [ ] Second\n  - [x] Third\n  - [x] First\n    details [[link]]'));
  await liveClick('First');
  state = await verify();
  assert.ok(state.text.includes('  - [ ] Second\n  - [ ] First\n    details [[link]]\n  - [x] Third'));
  assert.ok(state.text.includes('- [ ] Parent'));
  const completedChildren = note('- [ ] Active\n\n> [!done]- Completed\n> - [x] Finished\n>   - [ ] First\n>   - [ ] Second');
  await page.evaluate(text => window.mount(text), completedChildren);
  await doneClick('First');
  state = await verify();
  assert.ok(state.text.includes('> - [x] Finished\n>   - [ ] Second\n>   - [x] First'));
  await doneClick('First');
  state = await verify();
  assert.ok(state.text.includes('> - [x] Finished\n>   - [ ] Second\n>   - [ ] First'));

  await page.evaluate(text => window.mountReading(text), initial);
  const readingClick = name => page.locator('.markdown-reading-view label').filter({ hasText: new RegExp(name + '$') }).locator('input').click();
  const readingState = () => page.evaluate(() => window.readingSnapshot());
  await readingClick('Alpha');
  let reading = await readingState();
  assert.ok(reading.text.includes('> - [x] Alpha\n>   - [x] Alpha child'));
  assert.ok(reading.checks.every(check => check.correct));
  assert.equal(reading.nativeCalls, 0);
  assert.equal(reading.writes, 1);
  await readingClick('Alpha');
  reading = await readingState();
  assert.ok(reading.text.includes('- [ ] Charlie\n- [ ] Alpha\n  - [x] Alpha child'));
  assert.ok(reading.checks.every(check => check.correct));
  assert.equal(reading.writes, 2);
  // Keep the old DOM visible while its coordinates are stale. Clicking its
  // old Alpha row must not change the Bravo task now at that source line.
  await page.evaluate(() => window.pauseReadingRender(true));
  await readingClick('Alpha');
  const once = await readingState();
  await readingClick('Alpha');
  reading = await readingState();
  assert.equal(reading.text, once.text);
  assert.equal(reading.writes, once.writes);
  await page.evaluate(() => window.pauseReadingRender(false));
  assert.ok((await readingState()).checks.every(check => check.correct));
  assert.deepEqual(errors, []);
  console.log('Browser regressions passed: old bug reproduced; click state, callouts, keyboard, nesting and history verified.');
} finally {
  await browser?.close();
  await rm(dir, { recursive: true, force: true });
}
