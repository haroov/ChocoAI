import { makeAutoObservable } from 'mobx';

class AppSettingsStore {
  theme: AppTheme;
  currentTheme: AppTheme.Light | AppTheme.Dark;
  systemTheme: AppTheme.Light | AppTheme.Dark;
  language: string;

  features: Record<string, boolean> = {
    qaDashboard: false,
  };

  constructor() {
    this.theme = localStorage.getItem('theme') as AppTheme ?? AppTheme.Auto;
    this.systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? AppTheme.Dark : AppTheme.Light;
    this.currentTheme = this.theme === AppTheme.Auto ? this.systemTheme : this.theme;
    this.language = localStorage.getItem('language') || 'en';

    if (this.isRTL(this.language)) document.dir = 'rtl';

    makeAutoObservable(this);

    if (this.currentTheme === AppTheme.Light) document.querySelector('html')!.classList.remove('dark');
    else document.querySelector('html')!.classList.add('dark');
  }

  get qaEnabled() {
    return this.features.qaDashboard;
  }

  async fetchSettings() {
    try {
      const { apiClientStore } = await import('./apiClientStore');
      const res = await apiClientStore.fetch('/api/v1/settings');
      if (res.ok) {
        const data = await res.json();
        if (data.features) {
          this.features = { ...this.features, ...data.features };
        }
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    }
  }

  applyTheme(theme: AppTheme, systemTheme?: AppTheme.Light | AppTheme.Dark) {
    if (systemTheme) this.systemTheme = systemTheme;

    this.currentTheme = theme === AppTheme.Auto ? this.systemTheme : theme;
    this.theme = theme;
    localStorage.setItem('theme', this.theme);

    if (this.currentTheme === AppTheme.Light) document.querySelector('html')!.classList.remove('dark');
    else document.querySelector('html')!.classList.add('dark');
  }

  changeLanguage(language: string) {
    this.language = language;

    localStorage.setItem('language', this.language);

    document.dir = this.isRTL(language) ? 'rtl' : 'ltr';
  }

  private isRTL(language: string) {
    return ['he'].includes(language);
  }
}

export const appSettingsStore = new AppSettingsStore();

const darkThemeMq = window.matchMedia('(prefers-color-scheme: dark)');
darkThemeMq.addEventListener('change', (event) => {
  appSettingsStore.applyTheme(appSettingsStore.theme, event.matches ? AppTheme.Dark : AppTheme.Light);
});

export enum AppTheme {
  Auto = 'auto',
  Light = 'light',
  Dark = 'dark',
}
