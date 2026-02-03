import { useEffect } from 'react';
import mainLayoutStore, { type MainLayoutOptions } from './mainLayoutStore';

export default (opts: Partial<MainLayoutOptions>) => {
  useEffect(() => {
    mainLayoutStore.set(opts);

    return () => {
      mainLayoutStore.set({
        title: undefined,
      });
    };
  }, [
    opts.title,
  ]);
};
