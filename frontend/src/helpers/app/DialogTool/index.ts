import {
  AlertOptions,
  ConfirmOptions,
  ConfirmThenable,
  AlertThenable,
} from './types';
import dialogsStore from './dialogsStore';

export class DialogTool {
  alert(message: string): AlertThenable;
  alert(message: string, options: AlertOptions): AlertThenable;
  alert(title: string, message: string): AlertThenable;
  alert(title: string, message: string, options: AlertOptions): AlertThenable;
  alert(...args: unknown[]): AlertThenable {
    return this.#createDialog('alert', ...args) as AlertThenable;
  }

  confirm(message: string): ConfirmThenable;
  confirm(message: string, options: ConfirmOptions): ConfirmThenable;
  confirm(title: string, message: string): ConfirmThenable;
  confirm(title: string, message: string, options: ConfirmOptions): ConfirmThenable;
  confirm(...args: unknown[]): ConfirmThenable {
    return this.#createDialog('confirm', ...args) as ConfirmThenable;
  }

  #createDialog(dialogType: 'alert' | 'confirm', ...args: unknown[]): unknown {
    let resolve: () => void = () => null;
    let reject: () => void = () => null;
    const promise = new Promise((res, rej) => {
      resolve = res as never;
      reject = rej;
    });

    const options = (typeof args[1] === 'string' ? args[2] : args[1]) as (AlertOptions & ConfirmOptions) | undefined;

    dialogsStore.add({
      title: typeof args[1] === 'string' ? args[0] as string : undefined,
      message: typeof args[1] === 'string' ? args[1] as string : args[0] as string,
      onOk: resolve,
      onCancel: dialogType === 'confirm' ? reject : undefined,
      okButtonLabel: options?.okButtonLabel,
      cancelButtonLabel: options?.cancelButtonLabel,
    });

    return dialogType === 'alert' ?
      {
        then: (onfulfilled: () => void) => promise.then(onfulfilled),
      } : {
        then: (onfulfilled: () => void, onrejected?: () => void) => promise.then(onfulfilled, onrejected),
        catch: (onrejected: () => void) => promise.then(undefined, onrejected),
      };
  }
}
