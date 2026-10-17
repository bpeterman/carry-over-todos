import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { replacement, sortCheckboxChanges } from './task-blocks';

/** One transaction makes both the checkbox and its move undoable together. */
export function taskSortingExtension(enabled: (state: EditorState) => boolean) {
  return EditorState.transactionFilter.of(tr => {
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
}
