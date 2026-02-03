import { version } from '../../../package.json';
import PreloaderTool from './PreloaderTool';
import { DialogTool } from './DialogTool';
import { NotificationsTool } from './NotificationsTool';

class App {
  readonly #name: string;
  readonly #version: string;
  readonly #launchYear: number;

  readonly #preloader: PreloaderTool;
  readonly #notification: NotificationsTool;
  readonly #dialog: DialogTool;

  constructor() {
    this.#name = import.meta.env.VITE_APP_NAME;
    this.#launchYear = Number(import.meta.env.VITE_APP_LAUNCH_YEAR);

    this.#preloader = new PreloaderTool();
    this.#notification = new NotificationsTool();
    this.#dialog = new DialogTool();

    const appVersion = `v${version}`;
    this.#version = import.meta.env.DEV ? `${appVersion}-dev` : appVersion;
  }

  get name() { return this.#name; }
  get version() { return this.#version; }
  get launchYear() { return this.#launchYear; }

  get preloader() { return this.#preloader; }
  get notification() { return this.#notification; }
  get dialog() { return this.#dialog; }
}

export const app = new App();
export { DialogContainer } from './DialogTool/DialogContainer';
