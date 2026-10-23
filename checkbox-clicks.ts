import { parseTasks, sortCheckboxChanges } from './task-blocks';

export interface CheckboxChange { from: number; to: number; insert: string }

/** Resolve from Markdown, never from the browser's already-toggled checked value. */
export function checkboxChangeAtLine(content: string, line: number): CheckboxChange | undefined {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(eol);
  const task = parseTasks(lines)?.tasks.find(task => task.start === line);
  if (!task) return;
  const match = /\[([ xX])\]/.exec(lines[line]);
  if (!match) return;
  const from = lines.slice(0, line).reduce((offset, text) => offset + text.length + eol.length, 0) + match.index + 1;
  return { from, to: from + 1, insert: task.checked ? ' ' : 'x' };
}

export function toggleTaskAtLine(content: string, line: number): string | undefined {
  const change = checkboxChangeAtLine(content, line);
  if (!change) return;
  const after = content.slice(0, change.from) + change.insert + content.slice(change.to);
  return sortCheckboxChanges(content, after)?.text ?? after;
}

/** Reading view data-line is relative to its rendered section, not the note. */
export function renderedTaskLine(dataLine: string | null, sectionStart: number): number | undefined {
  if (dataLine === null || !/^\d+$/.test(dataLine) || !Number.isSafeInteger(sectionStart) || sectionStart < 0) return;
  const line = sectionStart + Number(dataLine);
  return Number.isSafeInteger(line) ? line : undefined;
}
