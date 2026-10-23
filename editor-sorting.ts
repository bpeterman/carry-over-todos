import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { checkboxChangeAtLine, renderedTaskLine } from './checkbox-clicks';
import { replacement, sortCheckboxChanges } from './task-blocks';

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
      // A canceled checkbox click restores the browser's old checked value at
      // the end of dispatch. Wait for that before CodeMirror reuses its DOM for
      // a different task. Also bypass Obsidian callouts' delayed DOM writes.
      queueMicrotask(() => {
        if (destroyed || view.state.doc !== doc || view.state.readOnly || !enabled(view.state)) return;
        view.dispatch({ changes: change, userEvent: 'input.task-checkbox' });
      });
    };
    view.dom.addEventListener('click', click, true);
    return { destroy() { destroyed = true; view.dom.removeEventListener('click', click, true); } };
  });
  return [filter, clicks];
}
