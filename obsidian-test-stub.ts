// Minimal host API for synthetic integration fixtures; never touches a vault.
import moment from 'moment';
import { StateField } from '@codemirror/state';
export { moment };
export const editorInfoField = StateField.define<any>({ create: () => ({}), update: value => value });
export class TFile { constructor(public path: string) {} }
export class Notice { constructor(public text: string) {} }
export class MarkdownRenderChild {
  constructor(public el: any) {}
  registerDomEvent(el: any, type: string, callback: any) { el.addEventListener(type, callback); }
}
export class Plugin {
  command: any;
  processor: any;
  extension: any;
  constructor(public app: any) {}
  registerEditorExtension(extension: any) { this.extension = extension; }
  registerMarkdownPostProcessor(processor: any) { this.processor = processor; }
  registerEvent(_event: any) {}
  register(_callback: any) {}
  addCommand(command: any) { this.command = command; }
}
