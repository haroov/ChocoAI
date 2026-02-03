import { en } from './en';

export { en };
export { he } from './he';

declare module 'use-intl' {
  interface AppConfig {
    Messages: typeof en;
  }
}
