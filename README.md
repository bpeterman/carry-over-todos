# Carry Over Todos

An Obsidian plugin that copies uncompleted todo items from the most recent previous daily note into today's daily note.

## Features

- **Smart lookback**: Finds the most recent previous daily note, walking back up to 30 days (handles weekends, vacations, or any gaps)
- **Preserves nesting**: Carries over nested/indented sub-tasks along with their parent
- **Cleans up source**: Removes carried-over items from the previous note, leaving completed todos intact
- **Template-aware**: Replaces the placeholder todo if present, otherwise appends to existing items
- **Clear notifications**: Tells you which date the todos are coming from (e.g. "Carrying over 5 todo(s) from Feb 16, 2026 (3 days ago)")

## Usage

1. Open today's daily note (create it first if it doesn't exist)
2. Open the command palette (`Cmd+P` / `Ctrl+P`)
3. Run **"Carry over uncompleted todos"**

## Expected Daily Note Format

The plugin expects daily notes with a TODO section using standard markdown checkboxes:

```markdown
# Thursday, February 19th, 2026

### TODO

- [ ] Uncompleted task
- [x] Completed task
- [ ] Another task
	- [ ] Nested sub-task

### Notes

The TODO section is identified by a `## TODO` or `### TODO` heading and ends at the next heading.

## Installation

### From this repo

```bash
npm install
npm run build
```

Copy `main.js` and `manifest.json` into your vault at `.obsidian/plugins/carry-over-todos/`.

### Development

```bash
npm install
npm run dev
```

This starts esbuild in watch mode, rebuilding `main.js` on every change to `main.ts`.

## Configuration

The plugin reads your daily notes settings (folder and date format) from Obsidian's built-in Daily Notes plugin configuration. No additional setup is required.
