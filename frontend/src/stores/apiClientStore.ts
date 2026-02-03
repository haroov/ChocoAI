import { makeAutoObservable, runInAction } from 'mobx';

class ApiClientStore {
  isAuthorized: boolean;

  constructor() {
    this.isAuthorized = false;

    makeAutoObservable(this);
  }

  setAuthorized(isAuthorized: boolean) {
    runInAction(() => { this.isAuthorized = isAuthorized; });
  }

  async fetch(...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
    // eslint-disable-next-line no-restricted-globals
    const res = await fetch(...args);

    // Only downgrade auth state on explicit 401.
    // Do NOT auto-upgrade auth state on any 200, as some endpoints may return 200 with { ok:false }.
    if (res.status === 401) {
      runInAction(() => { this.isAuthorized = false; });
    }

    return res;
  }

  async logout() {
    await this.fetch('/api/v1/auth/logout', { method: 'POST' });
    runInAction(() => { this.isAuthorized = false; });
  }
}

export const apiClientStore = new ApiClientStore();
