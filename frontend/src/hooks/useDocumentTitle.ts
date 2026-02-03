import { useEffect } from 'react';
import { app } from '../helpers/app';

export const useDocumentTitle = (title?: string) => {
  useEffect(() => {
    document.title = title ? `${title} | ${app.name}` : app.name;
  }, [title]);
};
