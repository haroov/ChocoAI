type Callback = () => void;

export type AlertThenable = {
  then: (onfulfilled: Callback) => Promise<void>;
}
export type ConfirmThenable = {
  then: (onfulfilled: Callback, onrejected?: Callback) => Promise<void>;
  catch: (onrejected: Callback) => Promise<void>;
}

export type AlertOptions = {
  okButtonLabel?: string;
}

export type ConfirmOptions = {
  okButtonLabel?: string;
  cancelButtonLabel?: string;
}
