import { makeAutoObservable } from 'mobx';
import { DialogBaseProps } from './DialogBase';

class DialogsStore {
  dialogs: Array<DialogBaseProps>;

  constructor() {
    this.dialogs = [];

    makeAutoObservable(this);
  }

  add(dialog: Omit<DialogBaseProps, 'id'>): string {
    const id = crypto.randomUUID();

    this.dialogs.push({ ...dialog, id });

    return id;
  }

  remove(dialogId: string) {
    this.dialogs = this.dialogs.filter((d) => d.id !== dialogId);
  }
}

export default new DialogsStore();
