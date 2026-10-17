import { strict as assert } from 'node:assert';
import CarryOverTodosPlugin from './main';
import { moment, TFile } from './obsidian-test-stub';
(moment as any).now = () => Date.UTC(2026, 9, 19, 16); // Monday, independent of host timezone.
const today = 'Daily Notes/2026/10/2026-10-19.md';
const sunday = 'Daily Notes/2026/10/2026-10-18.md';
const friday = 'Daily Notes/2026/10/2026-10-16.md';
const note = (s: string) => '## TODO\n\n' + s + '\n\n## Meetings\nUnrelated\n## Notes\nMore';
function host(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  const files = new Map([...data.keys()].map(path => [path, new TFile(path)]));
  let modify: (file: TFile) => void = () => {};
  let failDestination = false;
  let beforeProcess: ((file: TFile) => void) | undefined;
  const writes: string[] = [];
  const app = { internalPlugins: { plugins: { 'daily-notes': { instance: { options: { folder: 'Daily Notes', format: 'YYYY/MM/YYYY-MM-DD' } } } } }, vault: {
    getAbstractFileByPath: (path: string) => files.get(path),
    cachedRead: async (f: TFile) => data.get(f.path)!,
    read: async (f: TFile) => data.get(f.path)!,
    on: (_event: string, cb: typeof modify) => { modify = cb; },
    process: async (f: TFile, fn: (s: string) => string) => {
      beforeProcess?.(f);
      if (failDestination && f.path === today) throw new Error('synthetic write failure');
      const current = data.get(f.path)!, next = fn(current);
      if (next !== current) { data.set(f.path, next); writes.push(f.path); modify(f); }
      return next;
    },
  } };
  const plugin = new CarryOverTodosPlugin(app as any, {} as any) as any;
  return { data, files, writes, plugin, setFail: () => { failDestination = true; }, setBeforeProcess: (cb: typeof beforeProcess) => { beforeProcess = cb; }, edit(path: string, content: string) { data.set(path, content); modify(files.get(path)!); } };
}
const sourceBlock = '- [ ] Shared\n  - [x] Finished child\n    detail [[link]]\n  - [ ] Open child\n\n  continuation';
const h = host({ [today]: note('- [ ] Existing\n\n> [!done]- Completed\n> - [x] Older'), [sunday]: note(sourceBlock + '\n- [x] Done\n\n> [!done]- Completed\n> - [x] Archived'), [friday]: note('- [ ] Shared\n  different details') });
await h.plugin.onload();
await h.plugin.command.callback();
assert.ok(h.data.get(today)!.includes(sourceBlock), 'full open block including checked children is moved');
assert.ok(h.data.get(today)!.includes('- [ ] Shared\n  different details'), 'same title with different contents survives merge');
assert.ok(h.data.get(today)!.indexOf(sourceBlock) < h.data.get(today)!.indexOf('> [!done]'));
assert.ok(!h.data.get(sunday)!.includes(sourceBlock), 'carry-over moves rather than copies');
assert.ok(h.data.get(sunday)!.includes('- [x] Done\n\n> [!done]- Completed\n> - [x] Archived'));
assert.deepEqual(h.writes, [today, sunday, friday]);
const failure = host({ [today]: note('- [ ] Today'), [friday]: note(sourceBlock) });
await failure.plugin.onload();
failure.setFail();
const savedError = console.error; console.error = () => {};
try { await failure.plugin.command.callback(); } finally { console.error = savedError; }
assert.equal(failure.data.get(friday), note(sourceBlock), 'failed destination write leaves source intact');
const concurrent = host({ [today]: note('- [ ] Today'), [friday]: note(sourceBlock) });
await concurrent.plugin.onload();
concurrent.setBeforeProcess(f => { if (f.path === friday) concurrent.data.set(friday, note(sourceBlock + ' edited')); });
await concurrent.plugin.command.callback();
assert.ok(concurrent.data.get(friday)!.includes('edited'), 'concurrent source edit is retained');

const reading = host({ [today]: note('- [ ] A\n  - [x] Child\n- [ ] B') });
await reading.plugin.onload();
let click: (event: any) => void = () => {};
let isReading = true;
const el = { addEventListener: (_event: string, cb: typeof click) => { click = cb; }, closest: (selector: string) => selector === '.markdown-reading-view' && isReading ? el : null };
reading.plugin.processor(el, { sourcePath: today, addChild: () => {} });
await Promise.resolve();
const checkbox = { matches: () => true };
click({ target: checkbox });
reading.edit(today, reading.data.get(today)!.replace('[ ] A', '[x] A'));
await Promise.resolve(); await Promise.resolve();
assert.ok(reading.data.get(today)!.includes('> [!done]- Completed\n> - [x] A\n>   - [x] Child'), 'native Reading view write is sorted');
assert.equal(reading.writes.length, 1, 'our modify event does not loop');
click({ target: checkbox });
reading.edit(today, reading.data.get(today)!.replace('> - [x] A', '> - [ ] A'));
await Promise.resolve(); await Promise.resolve();
assert.ok(reading.data.get(today)!.includes('- [ ] B\n- [ ] A\n  - [x] Child'), 'Reading view uncheck restores complete block');
const writes = reading.writes.length;
isReading = false;
click({ target: checkbox });
reading.edit(today, reading.data.get(today)!.replace('- [ ] B', '- [x] B'));
await Promise.resolve(); await Promise.resolve();
assert.equal(reading.writes.length, writes, 'source-view click does not arm a competing disk sort');
isReading = true;
click({ target: checkbox });
reading.edit(today, reading.data.get(today)!.replace('- [ ] A', '- [x] A changed concurrently'));
await Promise.resolve(); await Promise.resolve();
assert.equal(reading.writes.length, writes, 'combined edits are kept untouched');
console.log('Plugin integration tests passed (synthetic vault only).');
