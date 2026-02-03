import { addToast } from '@heroui/react';
import { appSettingsStore } from '../../stores/appSettingsStore';
import { getTranslator } from '../getTranslator';

type NotificationType = 'info' | 'success' | 'error' | 'warning';

export class NotificationsTool {
  info(message: string): void {
    this.#show('info', message);
  }

  success(message: string): void {
    this.#show('success', message);
  }

  error(message: string): void {
    this.#show('error', message);
  }

  warning(message: string): void {
    this.#show('warning', message);
  }

  #show(type: NotificationType, message: string) {
    const t = getTranslator(appSettingsStore.language);

    const colors: { [key in NotificationType]: string } = {
      info: 'secondary',
      success: 'success',
      error: 'danger',
      warning: 'warning',
    };

    addToast({
      title: t(`Notification.${type}`),
      color: colors[type] as never,
      description: message,
    });
  }
}
