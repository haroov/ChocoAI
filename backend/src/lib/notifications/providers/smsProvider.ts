/**
 * SMS provider interface
 */
export interface SmsProvider {
  send(params: {
    to: string;
    body: string;
    from?: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }>;
}
