import { createTranslator } from 'use-intl';
import { en } from './localization';

export const getTranslator = (locale: string) => createTranslator({ messages: en, locale });
