import { makeAutoObservable } from 'mobx';

export type MainLayoutOptions = {
  title?: string;
}

class MainLayoutStore {
  title?: string;

  constructor() {
    makeAutoObservable(this);
  }

  set(options: MainLayoutOptions) {
    Object.entries(options).forEach(([key, value]) => {
      this[key as never] = value as never;
    });
  }
}

export default new MainLayoutStore();
