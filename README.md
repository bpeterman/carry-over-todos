# Carry Over Todos

An Obsidian plugin that moves unfinished task blocks from previous daily notes into today's note and sorts tasks when their checkboxes change.

## Automatic sorting

Sorting applies only to daily notes matching the folder and date format configured in Obsidian's built-in Daily Notes plugin, inside `## TODO` (or the older `### TODO` section). The section ends at the next level 1–3 heading.

- Checking a top-level task moves its entire block into `> [!done]- Completed` at the bottom of TODO. The group is created collapsed when needed.
- Unchecking a top-level task in Completed returns its block to the bottom of the active list. An empty Completed group is retained for reuse.
- Checking a subtask moves it after its siblings. Unchecking moves it before completed siblings within its own parent. Parent checkboxes stay unchanged.
- Task blocks retain nested subtasks (including checked ones), continuation text, notes, links, indentation and checkbox states. Tabs, spaces and deeper nesting are supported.
- Live Preview and Source mode changes use one editor transaction, so undo/redo restores both the checkbox and the move. The cursor follows its original text.
- Reading view uses native checkbox clicks followed by an atomic vault update. This relies on Obsidian rendering native interactive task checkboxes; third-party task renderers are not supported. Reading view has no editor undo history.

Sorting runs only for changes consisting entirely of checkbox-state transitions. Ordinary typing, mixed text edits, history undo/redo, remote editor transactions, code examples, other sections and other files are left alone. The plugin does not reorganize existing notes when enabled. Ambiguous duplicate Completed groups are left alone.

## Carry over unfinished tasks

1. Create today's daily note.
2. Open the command palette (`Cmd+P` / `Ctrl+P`).
3. Run **Carry over uncompleted todos**.

The command finds the newest previous daily note within 30 days. On weekdays, if that note is a weekend note, it also includes the latest weekday note. Weekend runs use only the newest note.

Entire open top-level blocks are **moved** into today's active TODO list, before Completed. Their checked subtasks travel with them; finished top-level tasks and the Completed group stay in the source. A lone `- [ ] Number 1` template placeholder is replaced. Identical blocks from multiple sources are merged, while identically named tasks with different contents are preserved.

Destination insertion must succeed before source cleanup. Cleanup removes only the exact blocks read earlier; concurrent source edits are retained. Carry-over is a multi-file operation, so an interrupted or partially failed run can leave duplicates; check the notes before retrying after an error.

## Daily layout

```markdown
## TODO

- [ ] Active task
  - [ ] Subtask
    Continuation with [[links]]
  - [x] Finished subtask

> [!done]- Completed
> - [x] Finished task
>   - [x] Its subtask

## Meetings

## Notes
```

Deferred work can live in `Task Backlog.md`; this plugin does not manage the backlog.

## Development and local installation

Use Node 18 or newer:

```bash
npm install
npm test
npm run typecheck
npm run build
```

Tests use synthetic notes and a mocked vault, plus real CodeMirror transactions and history. They never modify vault notes. CodeMirror is supplied by Obsidian at runtime and remains external to the plugin bundle.

Copy `main.js` and `manifest.json` into `.obsidian/plugins/carry-over-todos/` in the vault, then disable/re-enable **Carry Over Todos** in Community plugins or restart Obsidian. Source files are maintained in this repository. `npm run dev` rebuilds the bundle on edits.
