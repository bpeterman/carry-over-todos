import { Plugin, TFile, Notice, moment } from "obsidian";

interface DailyNotesConfig {
  folder: string;
  format: string;
}

const MAX_LOOKBACK_DAYS = 30;
const PLACEHOLDER_TODO = "- [ ] Number 1";

export default class CarryOverTodosPlugin extends Plugin {
  async onload() {
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

  private async findPreviousNote(): Promise<{ file: TFile; date: moment.Moment } | null> {
    const config = this.getDailyNotesConfig();
    const today = moment();

    for (let i = 1; i <= MAX_LOOKBACK_DAYS; i++) {
      const date = today.clone().subtract(i, "days");
      const path = this.buildNotePath(date, config);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        return { file, date };
      }
    }
    return null;
  }

  private extractUncompletedTodos(content: string): string[] {
    const lines = content.split("\n");

    let todoStart = -1;
    let todoEnd = lines.length;

    for (let i = 0; i < lines.length; i++) {
      if (todoStart === -1 && /^#{2,3}\s+TODO\s*$/.test(lines[i])) {
        todoStart = i + 1;
      } else if (todoStart !== -1 && /^#{1,3}\s+/.test(lines[i])) {
        todoEnd = i;
        break;
      }
    }

    if (todoStart === -1) return [];

    const todoLines = lines.slice(todoStart, todoEnd);
    const result: string[] = [];
    let skipChildren = false;

    for (const line of todoLines) {
      const isTopLevel = /^- \[.\]/.test(line);
      const isNested = /^\t+- \[.\]/.test(line);

      if (isTopLevel) {
        if (/^- \[ \]/.test(line)) {
          result.push(line);
          skipChildren = false;
        } else {
          skipChildren = true;
        }
      } else if (isNested && !skipChildren) {
        if (/^\t+- \[ \]/.test(line)) {
          result.push(line);
        }
      } else if (!isTopLevel && !isNested) {
        skipChildren = false;
      }
    }

    return result;
  }

  private async insertTodosIntoNote(file: TFile, todos: string[]): Promise<boolean> {
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");

    let todoHeadingIdx = -1;
    let sectionEnd = lines.length;

    for (let i = 0; i < lines.length; i++) {
      if (todoHeadingIdx === -1 && /^#{2,3}\s+TODO\s*$/.test(lines[i])) {
        todoHeadingIdx = i;
      } else if (todoHeadingIdx !== -1 && /^#{1,3}\s+/.test(lines[i])) {
        sectionEnd = i;
        break;
      }
    }

    if (todoHeadingIdx === -1) {
      new Notice("No TODO section found in today's daily note.");
      return false;
    }

    const sectionLines = lines.slice(todoHeadingIdx + 1, sectionEnd);
    const nonEmptyLines = sectionLines.filter((l) => l.trim().length > 0);

    const hasOnlyPlaceholder =
      nonEmptyLines.length === 1 && nonEmptyLines[0].trim() === PLACEHOLDER_TODO.trim();

    let newLines: string[];

    if (hasOnlyPlaceholder) {
      const placeholderIdx = lines.indexOf(PLACEHOLDER_TODO, todoHeadingIdx);
      newLines = [
        ...lines.slice(0, placeholderIdx),
        ...todos,
        ...lines.slice(placeholderIdx + 1),
      ];
    } else {
      let insertIdx = sectionEnd;
      for (let i = sectionEnd - 1; i > todoHeadingIdx; i--) {
        if (lines[i].trim().length > 0) {
          insertIdx = i + 1;
          break;
        }
      }
      newLines = [
        ...lines.slice(0, insertIdx),
        ...todos,
        ...lines.slice(insertIdx),
      ];
    }

    await this.app.vault.modify(file, newLines.join("\n"));
    return true;
  }

  private async removeUncompletedTodos(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");

    let todoStart = -1;
    let todoEnd = lines.length;

    for (let i = 0; i < lines.length; i++) {
      if (todoStart === -1 && /^#{2,3}\s+TODO\s*$/.test(lines[i])) {
        todoStart = i + 1;
      } else if (todoStart !== -1 && /^#{1,3}\s+/.test(lines[i])) {
        todoEnd = i;
        break;
      }
    }

    if (todoStart === -1) return;

    const before = lines.slice(0, todoStart);
    const after = lines.slice(todoEnd);
    const todoLines = lines.slice(todoStart, todoEnd);

    const kept: string[] = [];
    let skipChildren = false;

    for (const line of todoLines) {
      const isTopLevel = /^- \[.\]/.test(line);
      const isNested = /^\t+- \[.\]/.test(line);

      if (isTopLevel) {
        if (/^- \[ \]/.test(line)) {
          skipChildren = true;
        } else {
          skipChildren = false;
          kept.push(line);
        }
      } else if (isNested) {
        if (!skipChildren) {
          kept.push(line);
        }
      } else {
        kept.push(line);
        if (line.trim().length === 0) skipChildren = false;
      }
    }

    const newContent = [...before, ...kept, ...after].join("\n");
    await this.app.vault.modify(file, newContent);
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
    const config = this.getDailyNotesConfig();
    const todayPath = this.buildNotePath(moment(), config);
    const todayFile = this.app.vault.getAbstractFileByPath(todayPath);

    if (!(todayFile instanceof TFile)) {
      new Notice("Today's daily note doesn't exist yet. Create it first.");
      return;
    }

    const previous = await this.findPreviousNote();
    if (!previous) {
      new Notice("No recent daily note found in the last 30 days.");
      return;
    }

    const { file: prevFile, date: prevDate } = previous;
    const dateLabel = this.formatDateNotice(prevDate);

    const prevContent = await this.app.vault.read(prevFile);
    const todos = this.extractUncompletedTodos(prevContent);

    if (todos.length === 0) {
      new Notice(`No uncompleted todos to carry over from ${dateLabel}.`);
      return;
    }

    new Notice(`Carrying over ${todos.length} todo(s) from ${dateLabel}.`);

    const inserted = await this.insertTodosIntoNote(todayFile, todos);
    if (inserted) {
      await this.removeUncompletedTodos(prevFile);
    }
  }
}
