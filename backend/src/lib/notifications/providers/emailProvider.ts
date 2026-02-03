/**
 * Email provider interface
 */
export interface EmailProvider {
  send(params: {
    to: string;
    subject: string;
    body: string;
    from?: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }>;
}
