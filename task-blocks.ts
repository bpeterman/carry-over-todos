/** Line-based Markdown task blocks. No vault or editor writes happen here. */
interface Row { text: string; id: number }
export interface Task { start: number; end: number; indent: number; checked: boolean; parent?: Task; group: boolean }
interface Parsed { start: number; end: number; tasks: Task[]; completed?: { start: number; end: number } }
const quote = /^ {0,3}> ?/;
const listPattern = /^([ \t]*)(?:[-+*]|\d+[.)])(?:[ \t]+|$)/;
const taskPattern = /^([ \t]*)(?:[-+*]|\d+[.)]) \[([ xX])\](?:\s|$)/;
function width(s: string): number { let n = 0; for (const c of s) n = c === '\t' ? n + 4 - n % 4 : n + 1; return n; }
function bare(s: string, group: boolean): string { return group ? s.replace(quote, '') : s; }
function blank(s: string, group: boolean): boolean { return bare(s, group).trim() === ''; }

export function parseTasks(lines: string[]): Parsed | undefined {
  let start = -1, end = lines.length, fence = '', comment = false, completed: Parsed['completed'];
  const ignored = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].replace(quote, '');
    if (!fence && (comment || /^[ \t]*<!--/.test(s))) {
      ignored.add(i);
      comment = !s.includes('-->', comment ? 0 : s.indexOf('<!--') + 4);
      continue;
    }
    const f = /^[ \t]*(`{3,}|~{3,})/.exec(s);
    if (fence) { ignored.add(i); if (f && f[1][0] === fence[0] && f[1].length >= fence.length && /^[ \t]*(`+|~+)\s*$/.test(s)) fence = ''; continue; }
    if (f) { fence = f[1]; ignored.add(i); continue; }
    if (start < 0) { if (/^#{2,3}\s+TODO\s*$/.test(lines[i])) start = i + 1; }
    else if (/^#{1,3}\s+/.test(lines[i])) { end = i; break; }
  }
  if (start < 0) return;
  for (let i = start; i < end; i++) {
    if (!ignored.has(i) && /^ {0,3}> \[!done\][+-]?\s+Completed\s*$/i.test(lines[i])) {
      if (completed) return; // Ambiguous duplicate groups: leave the note alone.
      let j = i + 1;
      while (j < end && quote.test(lines[j]) && !/^ {0,3}> \[!/.test(lines[j])) j++;
      completed = { start: i, end: j };
    }
  }
  const tasks: Task[] = [], stack: Task[] = [];
  for (let i = start; i < end; i++) {
    const group = !!completed && i > completed.start && i < completed.end;
    const s = bare(lines[i], group);
    if (ignored.has(i)) continue;
    const match = taskPattern.exec(s);
    const list = listPattern.exec(s);
    const indent = width(/^[ \t]*/.exec(s)![0]);
    while (stack.length && (stack[stack.length - 1].group !== group || stack[stack.length - 1].end <= i || (!!list && indent <= stack[stack.length - 1].indent))) stack.pop();
    if (!list) continue;
    const parent = stack[stack.length - 1];
    if (parent && indent >= parent.indent + 10) continue; // Indented code under a list item.
    if (!parent && indent !== 0) continue; // Indented examples are not root tasks.
    const node: Task = { start: i, end: i + 1, indent, checked: !!match && match[2] !== ' ', parent, group };
    if (match) tasks.push(node);
    stack.push(node);
    // A block includes nested content, fenced examples and lazy continuation text.
    let j = i + 1;
    for (; j < end; j++) {
      if (group !== (!!completed && j > completed.start && j < completed.end)) break;
      const next = bare(lines[j], group);
      if (blank(lines[j], group) || ignored.has(j)) continue;
      const nextIndent = width(/^[ \t]*/.exec(next)![0]);
      if (nextIndent <= indent && (/^(?:[ \t]*)(?:[-+*]|\d+[.)])\s/.test(next) || /^\s*>/.test(next) || /^#{1,6}\s/.test(next))) break;
      if (nextIndent <= indent && blank(lines[j - 1], group)) break;
    }
    while (j > i + 1 && blank(lines[j - 1], group)) j--;
    node.end = j;
  }
  return { start, end, tasks, completed };
}

function changedTasks(before: string[], after: string[], parsed: Parsed): number[] | undefined {
  if (before.length !== after.length) return;
  const changed: number[] = [];
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue;
    const node = parsed.tasks.find(t => t.start === i);
    if (!node) return;
    const a = taskPattern.exec(bare(before[i], node.group)), b = taskPattern.exec(bare(after[i], node.group));
    if (!a || !b || (a[2] === ' ') === (b[2] === ' ') || before[i].replace(/\[([ xX])\]/, '[ ]') !== after[i].replace(/\[([ xX])\]/, '[ ]')) return;
    changed.push(i);
  }
  return changed;
}

export interface SortedChange { text: string; mapOffset: (offset: number) => number }
export function sortCheckboxChanges(before: string, after: string): SortedChange | undefined {
  const eol = after.includes('\r\n') ? '\r\n' : '\n';
  const input = after.split(eol), parsed = parseTasks(input);
  if (!parsed) return;
  const changed = changedTasks(before.split(eol), input, parsed);
  if (!changed?.length) return;
  const rows: Row[] = input.map((text, id) => ({ text, id }));
  for (const id of changed) {
    const p = parseTasks(rows.map(r => r.text));
    const task = p?.tasks.find(t => rows[t.start].id === id);
    if (!p || !task) continue;
    const block = rows.slice(task.start, task.end);
    if (task.parent) {
      const siblings = p.tasks.filter(t => t.parent === task.parent && t !== task);
      // Move only the toggled sibling, preserving the order of the others.
      const firstDone = siblings.find(t => t.checked);
      const last = siblings[siblings.length - 1];
      const destination = task.checked ? (last?.end ?? task.end) : (firstDone?.start ?? last?.end ?? task.end);
      if (destination >= task.start && destination <= task.end) continue;
      rows.splice(task.start, block.length);
      rows.splice(destination > task.start ? destination - block.length : destination, 0, ...block);
    } else if (task.checked && !task.group) {
      rows.splice(task.start, block.length);
      const updated = parseTasks(rows.map(r => r.text))!;
      for (const r of block) r.text = '> ' + r.text;
      if (updated.completed) rows.splice(updated.completed.end, 0, ...block);
      else {
        let at = updated.end;
        while (at > updated.start && rows[at - 1].text.trim() === '') at--;
        rows.splice(at, 0, { text: '', id: -1 }, { text: '> [!done]- Completed', id: -1 }, ...block);
      }
    } else if (!task.checked && task.group) {
      rows.splice(task.start, block.length);
      for (const r of block) r.text = bare(r.text, true);
      const updated = parseTasks(rows.map(r => r.text))!;
      let at = updated.completed!.start;
      while (at > updated.start && rows[at - 1].text.trim() === '') at--;
      rows.splice(at, 0, ...block);
    }
  }
  const text = rows.map(r => r.text).join(eol);
  if (text === after) return;
  return { text, mapOffset(offset) {
    let line = 0, from = 0;
    while (line < input.length - 1 && from + input[line].length < offset) { from += input[line].length + eol.length; line++; }
    const at = rows.findIndex(r => r.id === line);
    if (at < 0) return Math.min(offset, text.length);
    const prefix = rows.slice(0, at).reduce((n, r) => n + r.text.length + eol.length, 0);
    return prefix + Math.max(0, Math.min(rows[at].text.length, offset - from + rows[at].text.length - input[line].length));
  } };
}

export function openTaskBlocks(content: string): string[][] {
  const lines = content.split(/\r?\n/), p = parseTasks(lines);
  return p ? p.tasks.filter(t => !t.parent && !t.group && !t.checked).map(t => lines.slice(t.start, t.end)) : [];
}
export function removeOpenTaskBlocks(content: string, expected: string[][]): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n', lines = content.split(eol), p = parseTasks(lines);
  if (!p) return content;
  for (const t of p.tasks.filter(t => !t.parent && !t.group && !t.checked).reverse()) {
    if (expected.some(block => block.join('\n') === lines.slice(t.start, t.end).join('\n'))) lines.splice(t.start, t.end - t.start);
  }
  return lines.join(eol);
}
export function insertTaskBlocks(content: string, blocks: string[][]): string | undefined {
  const eol = content.includes('\r\n') ? '\r\n' : '\n', lines = content.split(eol), p = parseTasks(lines);
  if (!p) return;
  const nonempty = lines.slice(p.start, p.end).filter(s => s.trim());
  if (nonempty.length === 1 && nonempty[0] === '- [ ] Number 1') {
    lines.splice(lines.indexOf(nonempty[0], p.start), 1, ...blocks.flat());
  } else {
    let at = p.completed?.start ?? p.end;
    while (at > p.start && !lines[at - 1].trim()) at--;
    lines.splice(at, 0, ...blocks.flat());
  }
  return lines.join(eol);
}

/** Smallest single replacement, keeping unrelated editor text outside the change. */
export function replacement(before: string, after: string): { from: number; to: number; insert: string } {
  let from = 0, end = 0;
  while (from < before.length && from < after.length && before[from] === after[from]) from++;
  while (end < before.length - from && end < after.length - from && before[before.length - end - 1] === after[after.length - end - 1]) end++;
  return { from, to: before.length - end, insert: after.slice(from, after.length - end) };
}
