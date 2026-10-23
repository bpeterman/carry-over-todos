// Host-faithful checkbox widgets for real browser event/default-action tests.
// These reproduce Obsidian's checked-value equality, native input handler and
// callout handler's delayed DOM update without loading any private notes.
import { EditorState, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { history, undo, redo, undoDepth } from '@codemirror/commands';
import { taskSortingExtension } from './editor-sorting';
import { parseTasks } from './task-blocks';

let nativeCalls = 0;
class TaskWidget extends WidgetType {
  constructor(readonly char: string) { super(); }
  eq(other: TaskWidget) { return this.char === other.char; }
  updateDOM(label: HTMLElement) {
    const input = label.firstChild as HTMLInputElement;
    input.dataset.task = this.char;
    input.checked = this.char !== ' ';
    return true;
  }
  toDOM(view: EditorView) {
    const label = document.createElement('label');
    label.className = 'task-list-label';
    const input = document.createElement('input');
    input.type = 'checkbox'; input.className = 'task-list-item-checkbox';
    input.dataset.task = this.char; input.checked = this.char !== ' ';
    label.append(input);
    label.addEventListener('mousedown', event => event.preventDefault());
    input.addEventListener('input', () => {
      nativeCalls++;
      const line = view.state.doc.lineAt(view.posAtDOM(input));
      const at = line.text.search(/\[.\]/) + 1;
      view.dispatch({ changes: { from: line.from + at, to: line.from + at + 1, insert: line.text[at] === ' ' ? 'x' : ' ' } });
    });
    return label;
  }
}
class CalloutWidget extends WidgetType {
  constructor(public text: string, readonly start: number) { super(); }
  eq(other: CalloutWidget) { return this.text === other.text; }
  toDOM(view: EditorView) {
    const el = document.createElement('div'); el.className = 'cm-callout';
    const lines = this.text.split('\n');
    for (let i = 1; i < lines.length; i++) {
      const match = /^> (\s*)- \[([ xX])\] (.*)$/.exec(lines[i]);
      if (!match) continue;
      const label = document.createElement('label'); label.style.display = 'block';
      const input = document.createElement('input');
      input.type = 'checkbox'; input.className = 'task-list-item-checkbox';
      input.dataset.line = String(i); input.checked = match[2] !== ' ';
      label.append(input, document.createTextNode(match[3])); el.append(label);
    }
    el.addEventListener('click', event => {
      const input = event.target as HTMLInputElement;
      if (!input.matches('input')) return;
      nativeCalls++; event.preventDefault();
      const current = this.text.split('\n'), i = Number(input.dataset.line);
      const at = current[i].search(/\[.\]/) + 1;
      const char = current[i][at] === ' ' ? 'x' : ' ';
      current[i] = current[i].slice(0, at) + char + current[i].slice(at + 1);
      const before = this.text; this.text = current.join('\n');
      setTimeout(() => { input.checked = char !== ' '; }, 0);
      view.dispatch({ changes: { from: this.start, to: this.start + before.length, insert: this.text } });
    });
    return el;
  }
}
function decorations(state: EditorState) {
  const lines = state.doc.toString().split('\n'), p = parseTasks(lines);
  if (!p) return Decoration.none;
  const ranges = [];
  for (const task of p.tasks) {
    if (task.group) continue;
    const line = state.doc.line(task.start + 1), at = line.text.search(/\[.\]/);
    ranges.push(Decoration.replace({ widget: new TaskWidget(task.checked ? 'x' : ' ') }).range(line.from + at, line.from + at + 3));
  }
  if (p.completed && p.completed.end > p.completed.start + 1) {
    const from = state.doc.line(p.completed.start + 1).from, to = state.doc.line(p.completed.end).to;
    ranges.push(Decoration.replace({ widget: new CalloutWidget(state.doc.sliceString(from, to), from), block: true }).range(from, to));
  }
  return Decoration.set(ranges, true);
}
const widgets = StateField.define({ create: decorations, update: (_value, tr) => decorations(tr.state), provide: field => EditorView.decorations.from(field) });
let view: EditorView;
(window as any).mount = (text: string, fixed = true) => {
  view?.destroy(); nativeCalls = 0;
  const extension = taskSortingExtension(() => true);
  view = new EditorView({ parent: document.body, state: EditorState.create({ doc: text, extensions: [widgets, history(), fixed ? extension : extension[0]] }) });
};
(window as any).snapshot = () => ({ text: view.state.doc.toString(), nativeCalls, undoDepth: undoDepth(view.state), checks: Array.from(view.dom.querySelectorAll<HTMLInputElement>('input.task-list-item-checkbox')).map(input => {
  const block = input.closest('.cm-callout');
  const line = block ? view.state.doc.lineAt(view.posAtDOM(block)).number + Number(input.dataset.line) : view.state.doc.lineAt(view.posAtDOM(input)).number;
  const source = view.state.doc.line(line).text;
  return { source, checked: input.checked, correct: input.checked === !source.includes('[ ]') };
}) });
(window as any).undo = () => undo(view);
(window as any).redo = () => redo(view);
(window as any).edit = (text: string) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });

import CarryOverTodosPlugin from './main';
import { TFile } from './obsidian-test-stub';
let readingText = '', readingWrites = 0, pauseRender = false;
let readingPlugin: any;
let readingEl: HTMLDivElement;
function renderReading() {
  const section = document.createElement('div');
  readingEl.replaceChildren(section);
  const renderedText = readingText;
  const lines = readingText.split('\n'), parsed = parseTasks(lines)!;
  const sectionStart = parsed.start;
  for (const task of parsed.tasks) {
    const label = document.createElement('label'); label.style.display = 'block';
    const input = document.createElement('input');
    input.type = 'checkbox'; input.className = 'task-list-item-checkbox';
    input.dataset.line = String(task.start - sectionStart); input.checked = task.checked;
    label.append(input, document.createTextNode(lines[task.start].replace(/^.*?\[.\] /, '')));
    section.append(label);
  }
  readingPlugin.processor(section, { sourcePath: 'Daily Notes/2026/10/2026-10-23.md', addChild: () => {}, getSectionInfo: () => ({ text: renderedText, lineStart: sectionStart }) });
}
(window as any).mountReading = async (text: string) => {
  view?.destroy(); nativeCalls = 0; readingText = text; readingWrites = 0; pauseRender = false;
  readingEl?.remove(); readingEl = document.createElement('div'); readingEl.className = 'markdown-reading-view'; document.body.append(readingEl);
  const file = new TFile('Daily Notes/2026/10/2026-10-23.md');
  readingPlugin = new (CarryOverTodosPlugin as any)({ vault: {
    getAbstractFileByPath: () => file,
    process: async (_file: TFile, fn: (s: string) => string) => {
      const next = fn(readingText);
      if (next !== readingText) { readingWrites++; readingText = next; if (!pauseRender) renderReading(); }
      return readingText;
    },
  } });
  await readingPlugin.onload();
  // Obsidian's native Reading handler is downstream from the plugin capture.
  readingEl.addEventListener('click', () => { nativeCalls++; });
  renderReading();
};
(window as any).pauseReadingRender = (pause: boolean) => { pauseRender = pause; if (!pause) renderReading(); };
(window as any).readingSnapshot = () => ({ text: readingText, writes: readingWrites, nativeCalls, checks: Array.from(readingEl.querySelectorAll<HTMLInputElement>('input')).map(input => {
  const task = parseTasks(readingText.split('\n'))!.tasks[Array.from(readingEl.querySelectorAll('input')).indexOf(input)];
  return { checked: input.checked, correct: task && input.checked === task.checked };
}) });

(window as any).corruptCheckboxDisplay = () => {
  view.dom.querySelector<HTMLInputElement>('input.task-list-item-checkbox')!.checked = true;
};
