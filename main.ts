import { Plugin, TFile, Notice, moment, editorInfoField, MarkdownRenderChild } from "obsidian";
import { selectCarryOverSources } from "./source-selection";
import { taskSortingExtension } from "./editor-sorting";
import { openTaskBlocks, removeOpenTaskBlocks, insertTaskBlocks } from "./task-blocks";
import { checkboxChangeAtLine, renderedTaskLine, toggleTaskAtLine } from "./checkbox-clicks";

interface DailyNotesConfig {
  folder: string;
  format: string;
}

interface DailyNoteCandidate {
  file: TFile;
  date: moment.Moment;
  day: number;
}

const MAX_LOOKBACK_DAYS = 30;

export default class CarryOverTodosPlugin extends Plugin {
  private carrying = false;

  async onload() {
    this.registerEditorExtension(taskSortingExtension(state => {
      const file = state.field(editorInfoField, false)?.file;
      return !!file && this.isDailyNote(file);
    }));
    this.registerMarkdownPostProcessor((el, ctx) => {
      const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      if (!(file instanceof TFile) || !this.isDailyNote(file)) return;
      const child = new MarkdownRenderChild(el);
      ctx.addChild(child);
      child.registerDomEvent(el, 'click', event => {
        const target = event.target as HTMLInputElement | null;
        if (!target?.matches('input.task-list-item-checkbox') || !el.closest('.markdown-reading-view') || el.closest('.markdown-source-view')) return;
        const section = ctx.getSectionInfo(target);
        if (!section) return;
        const line = renderedTaskLine(target.getAttribute('data-line'), section.lineStart);
        if (line === undefined || !checkboxChangeAtLine(section.text, line)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        // Own the toggle and the move in one atomic write. A rendered section
        // may lag behind the file; stale coordinates must never toggle a neighbor.
        let stale = false;
        void Promise.resolve().then(() => this.app.vault.process(file, current => {
          if (current !== section.text) { stale = true; return current; }
          return toggleTaskAtLine(current, line) ?? current;
        })).then(() => {
          if (stale) new Notice('The task list changed. Let it refresh, then click the task again.');
        }).catch(error => {
          console.error('Carry Over Todos: checkbox update failed', error);
          new Notice('Could not update the task. Please try again.');
        });
      }, { capture: true });
    });
    this.addCommand({
      id: "carry-over",
      name: "Carry over uncompleted todos",
      callback: () => this.carryOverTodos(),
    });
  }

  private getDailyNotesConfig(): DailyNotesConfig {
    const config = (this.app as any).internalPlugins?.plugins?.["daily-notes"]
      ?.instance?.options;
    return {
      folder: config?.folder ?? "Daily Notes",
      format: config?.format ?? "YYYY/MM/YYYY-MM-DD",
    };
  }

  private buildNotePath(date: moment.Moment, config: DailyNotesConfig): string {
    return `${config.folder}/${date.format(config.format)}.md`;
  }

  private findPreviousNotes(): DailyNoteCandidate[] {
    const config = this.getDailyNotesConfig();
    const today = moment();
    const candidates: DailyNoteCandidate[] = [];

    for (let i = 1; i <= MAX_LOOKBACK_DAYS; i++) {
      const date = today.clone().subtract(i, "days");
      const path = this.buildNotePath(date, config);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        candidates.push({ file, date, day: date.day() });
      }
    }

    return selectCarryOverSources(today.day(), candidates);
  }

  private isDailyNote(file: TFile): boolean {
    const config = this.getDailyNotesConfig();
    const prefix = config.folder ? config.folder.replace(/\/$/, '') + '/' : '';
    if (!file.path.startsWith(prefix) || !file.path.endsWith('.md')) return false;
    return moment(file.path.slice(prefix.length, -3), config.format, true).isValid();
  }

  private formatDateNotice(date: moment.Moment): string {
    const today = moment().startOf("day");
    const diff = today.diff(date.clone().startOf("day"), "days");

    if (diff === 1) {
      return "yesterday";
    }
    return `${date.format("MMM D, YYYY")} (${diff} days ago)`;
  }

  private async carryOverTodos() {
    if (this.carrying) return;
    this.carrying = true;
    try {
      await this.moveTodos();
    } catch (error) {
      console.error('Carry Over Todos: carry-over failed', error);
      new Notice('Carry-over could not finish. Check the daily notes before retrying.');
    } finally {
      this.carrying = false;
    }
  }

  private async moveTodos() {
    const config = this.getDailyNotesConfig();
    const todayPath = this.buildNotePath(moment(), config);
    const todayFile = this.app.vault.getAbstractFileByPath(todayPath);

    if (!(todayFile instanceof TFile)) {
      new Notice("Today's daily note doesn't exist yet. Create it first.");
      return;
    }

    const sources = this.findPreviousNotes();
    if (sources.length === 0) {
      new Notice("No recent daily note found in the last 30 days.");
      return;
    }

    const todoLists = await Promise.all(sources.map(async ({ file }) => {
      return openTaskBlocks(await this.app.vault.read(file));
    }));
    // Preserve distinct blocks even when their first lines match. This avoids
    // dropping different notes or subtasks attached to identically named work.
    const seen = new Set<string>();
    const todos = todoLists.flat().filter(block => {
      const key = block.join('\n');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const dateLabel = sources
      .map(({ date }) => this.formatDateNotice(date))
      .join(" and ");

    if (todos.length === 0) {
      new Notice(`No uncompleted todos to carry over from ${dateLabel}.`);
      return;
    }

    new Notice(`Carrying over ${todos.length} todo(s) from ${dateLabel}.`);

    let inserted = false;
    await this.app.vault.process(todayFile, content => {
      const next = insertTaskBlocks(content, todos);
      inserted = next !== undefined;
      return next ?? content;
    });
    if (!inserted) {
      new Notice("No TODO section found in today's daily note.");
      return;
    }
    // Remove only exact blocks read above; concurrent changes remain in source.
    for (let i = 0; i < sources.length; i++) {
      await this.app.vault.process(sources[i].file, content => removeOpenTaskBlocks(content, todoLists[i]));
    }
  }
}
