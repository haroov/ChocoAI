/**
 * Notification template definitions
 *
 * Templates support {variable} placeholders that are replaced with actual values
 * when sending notifications.
 */

export interface NotificationTemplate {
  id: string;
  channel: 'email' | 'sms';
  language: 'hebrew' | 'english';
  subject?: string; // Email only
  body: string; // Supports {variable} placeholders
  variables: string[]; // Required variables
}

export const templates: Record<string, NotificationTemplate> = {
  'verification-code-email-he': {
    id: 'verification-code-email-he',
    channel: 'email',
    language: 'hebrew',
    subject: 'קוד אימות ChocoAI',
    body: 'שלום {firstName},\n\nקוד האימות שלך הוא: {code}\n\nקוד זה תקף ל-10 דקות.',
    variables: ['firstName', 'code'],
  },
  'verification-code-email-en': {
    id: 'verification-code-email-en',
    channel: 'email',
    language: 'english',
    subject: 'ChocoAI Verification Code',
    body: 'Hello {firstName},\n\nYour verification code is: {code}\n\nThis code is valid for 10 minutes.',
    variables: ['firstName', 'code'],
  },
  'verification-code-sms-he': {
    id: 'verification-code-sms-he',
    channel: 'sms',
    language: 'hebrew',
    body: 'קוד האימות שלך: {code}. תקף ל-10 דקות.',
    variables: ['code'],
  },
  'verification-code-sms-en': {
    id: 'verification-code-sms-en',
    channel: 'sms',
    language: 'english',
    body: 'Your verification code: {code}. Valid for 10 minutes.',
    variables: ['code'],
  },
  'gateway-intro-email-he': {
    id: 'gateway-intro-email-he',
    channel: 'email',
    language: 'hebrew',
    subject: 'הגדרת ספק סליקה',
    body: 'שלום {firstName},\n\nאנחנו מגדירים כעת את {providerName} עבור {orgName}...',
    variables: ['firstName', 'providerName', 'orgName'],
  },
  'gateway-intro-email-en': {
    id: 'gateway-intro-email-en',
    channel: 'email',
    language: 'english',
    subject: 'Setting up your payment gateway',
    body: 'Hi {firstName},\n\nWe\'re setting up {providerName} for {orgName}...',
    variables: ['firstName', 'providerName', 'orgName'],
  },
  'donor-support-email-en': {
    id: 'donor-support-email-en',
    channel: 'email',
    language: 'english',
    subject: '[ChocoAI] Donor support request ({env})',
    body: [
      'Donor support request received.',
      '',
      'Environment: {env}',
      'Timestamp: {timestamp}',
      'Conversation: {conversationId}',
      '',
      'Donor:',
      '- Name: {name}',
      '- Email: {email}',
      '- Phone: {phone}',
      '',
      'Request:',
      '{request}',
    ].join('\n'),
    variables: ['env', 'timestamp', 'conversationId', 'name', 'email', 'phone', 'request'],
  },
  'donor-support-email-he': {
    id: 'donor-support-email-he',
    channel: 'email',
    language: 'hebrew',
    subject: '[ChocoAI] בקשת תמיכה מתורם ({env})',
    body: [
      'התקבלה בקשת תמיכה מתורם.',
      '',
      'סביבה: {env}',
      'זמן: {timestamp}',
      'שיחה: {conversationId}',
      '',
      'תורם:',
      '- שם: {name}',
      '- אימייל: {email}',
      '- טלפון: {phone}',
      '',
      'הבקשה:',
      '{request}',
    ].join('\n'),
    variables: ['env', 'timestamp', 'conversationId', 'name', 'email', 'phone', 'request'],
  },
};

/**
 * Get template by ID, automatically selecting language variant if needed
 */
export function getTemplate(templateId: string, language?: 'hebrew' | 'english'): NotificationTemplate | null {
  // If templateId includes language suffix, use it directly
  if (templates[templateId]) {
    return templates[templateId];
  }

  // Otherwise, try to find language-specific variant
  if (language) {
    const langSuffix = language === 'hebrew' ? 'he' : 'en';
    const languageSpecificId = `${templateId}-${langSuffix}`;
    if (templates[languageSpecificId]) {
      return templates[languageSpecificId];
    }
  }

  // Fallback: try both language variants
  const heTemplate = templates[`${templateId}-he`];
  const enTemplate = templates[`${templateId}-en`];

  return heTemplate || enTemplate || null;
}

/**
 * Replace template variables in a string
 */
export function replaceTemplateVariables(template: string, data: Record<string, unknown>): string {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\{${key}\\}`, 'g');
    result = result.replace(regex, value !== null && value !== undefined ? String(value) : '');
  }
  return result;
}
