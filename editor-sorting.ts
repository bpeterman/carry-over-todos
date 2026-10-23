import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { checkboxChangeAtLine, renderedTaskLine } from './checkbox-clicks';
import { parseTasks, replacement, sortCheckboxChanges } from './task-blocks';

/** A rendered callout's data-line is relative to the callout source block. */
function checkboxLine(view: EditorView, checkbox: HTMLInputElement): number | undefined {
  // Embedded notes have their own source and must keep their native behavior.
  if (checkbox.closest('.markdown-embed, .internal-embed')) return;
  const callout = checkbox.closest('.cm-callout');
  try {
    if (callout) {
      const start = view.state.doc.lineAt(view.posAtDOM(callout)).number - 1;
      return renderedTaskLine(checkbox.getAttribute('data-line'), start);
    }
    // Normal Live Preview task widgets carry data-task. Other rendered widgets
    // cannot be safely mapped with posAtDOM alone.
    if (!checkbox.hasAttribute('data-task')) return;
    return view.state.doc.lineAt(view.posAtDOM(checkbox)).number - 1;
  } catch {
    return; // Detached or unrecognized widget: do not guess at another task.
  }
}

/** One transaction makes both the checkbox and its move undoable together. */
export function taskSortingExtension(enabled: (state: EditorState) => boolean) {
  const filter = EditorState.transactionFilter.of(tr => {
    if (!tr.docChanged || tr.isUserEvent('undo') || tr.isUserEvent('redo') || tr.annotation(Transaction.remote) || !enabled(tr.startState)) return tr;
    const after = tr.newDoc.toString();
    const sorted = sortCheckboxChanges(tr.startState.doc.toString(), after);
    if (!sorted) return tr;
    return [tr, {
      changes: replacement(after, sorted.text),
      selection: EditorSelection.create(tr.newSelection.ranges.map(r => EditorSelection.range(sorted.mapOffset(r.anchor), sorted.mapOffset(r.head))), tr.newSelection.mainIndex),
      sequential: true,
    }];
  });
  const clicks = ViewPlugin.define(view => {
    let destroyed = false;
    const win = view.dom.ownerDocument.defaultView!;
    const pending = new Set<number>();
    let syncQueued = false;
    const schedule = (callback: () => void) => {
      const timer = win.setTimeout(() => {
        pending.delete(timer);
        if (!destroyed) callback();
      }, 0);
      pending.add(timer);
    };
    const sync = () => {
      if (syncQueued) return;
      syncQueued = true;
      schedule(() => {
        syncQueued = false;
        if (!enabled(view.state)) return;
        const lines = view.state.doc.toString().split('\n');
        const tasks = new Map(parseTasks(lines)?.tasks.map(task => [task.start, task]));
        // Obsidian can retain widgets across a plugin reload. Repair their
        // display from Markdown without changing any stored checkbox state.
        view.dom.querySelectorAll<HTMLInputElement>('input.task-list-item-checkbox').forEach(input => {
          const line = checkboxLine(view, input);
          const task = line === undefined ? undefined : tasks.get(line);
          if (!task) return;
          input.checked = task.checked;
          const char = /\[([ xX])\]/.exec(lines[task.start])![1];
          if (input.hasAttribute('data-task')) input.dataset.task = char;
          const item = input.parentElement;
          if (item?.matches('li.task-list-item')) {
            item.classList.toggle('is-checked', task.checked);
            item.setAttribute('data-task', char);
          }
        });
      });
    };
    const click = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.matches('input.task-list-item-checkbox') || view.state.readOnly || !enabled(view.state)) return;
      const line = checkboxLine(view, target as HTMLInputElement);
      if (line === undefined) return;
      const doc = view.state.doc;
      const change = checkboxChangeAtLine(doc.toString(), line);
      if (!change) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // Microtasks can run before a canceled click's activation rollback.
      // Use the next event-loop task so that rollback cannot overwrite a
      // reused widget's new state (including toggles that do not move a task).
      schedule(() => {
        if (view.state.doc !== doc || view.state.readOnly || !enabled(view.state)) return;
        view.dispatch({ changes: change, userEvent: 'input.task-checkbox' });
      });
    };
    view.dom.addEventListener('click', click, true);
    sync();
    return { update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) sync();
    }, destroy() {
      destroyed = true;
      for (const timer of pending) win.clearTimeout(timer);
      pending.clear();
      view.dom.removeEventListener('click', click, true);
    } };
  });
  return [filter, clicks];
}
