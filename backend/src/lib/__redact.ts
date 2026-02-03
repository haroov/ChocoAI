/**
 * PII Masking and Redaction Utilities
 *
 * Provides consistent PII masking across all APIs and responses.
 * This ensures that sensitive data is never exposed in logs, API responses, or UI.
 */

/**
 * Mask PII in field values for API responses
 * Consistent with the masking used in conversation fields API
 */
export function maskPII(key: string, value: any): string {
  if (!value) return '';

  const stringValue = String(value);

  // Mask sensitive fields
  if (key === 'password' || key === 'password_confirm') {
    return '••••••••';
  }

  // Don't mask email addresses - they should be visible to the user
  // if (key === 'email') {
  //   const [local, domain] = stringValue.split('@');
  //   if (local.length <= 2) return stringValue;
  //   return `${local[0]}${'*'.repeat(local.length - 2)}${local[local.length - 1]}@${domain}`;
  // }

  if (key === 'phone') {
    if (stringValue.length <= 4) return stringValue;
    return `${stringValue.slice(0, -4)}****`;
  }

  // For other fields, return as-is
  return stringValue;
}

/**
 * Redact secrets from log messages and API responses
 * Used for JWT tokens, API keys, and other sensitive data
 */
export function redactSecrets(text: string): string {
  if (!text) return '';

  if (process.env.REDACT_SECRETS !== 'false') {
    return text
      .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, 'Bearer [REDACTED]')
      .replace(/Authorization:\s*Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, 'Authorization: Bearer [REDACTED]')
      .replace(/api[_-]?key[=:]\s*[A-Za-z0-9\-._~+/]+=*/gi, 'api_key=[REDACTED]')
      .replace(/token[=:]\s*[A-Za-z0-9\-._~+/]+=*/gi, 'token=[REDACTED]');
  }

  return text;
}

/**
 * Mask sensitive data in JSON objects
 * Recursively masks PII fields in nested objects
 */
export function maskSensitiveData(obj: any, sensitiveKeys: string[] = ['password', 'email', 'phone', 'token', 'apiKey']): any {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    // Check if this looks like a sensitive value
    if (sensitiveKeys.some((key) => obj.toLowerCase().includes(key.toLowerCase()))) {
      return '[MASKED]';
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => maskSensitiveData(item, sensitiveKeys));
  }

  if (typeof obj === 'object') {
    const masked: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some((sensitiveKey) => lowerKey.includes(sensitiveKey.toLowerCase()))) {
        masked[key] = '[MASKED]';
      } else {
        masked[key] = maskSensitiveData(value, sensitiveKeys);
      }
    }
    return masked;
  }

  return obj;
}

/**
 * Validate that PII masking is working correctly
 * Used in tests to ensure no sensitive data leaks
 */
export function validatePIIMasking(obj: any): { hasUnmaskedPII: boolean; unmaskedFields: string[] } {
  const unmaskedFields: string[] = [];

  function checkObject(obj: any, path: string = '') {
    if (obj === null || obj === undefined) return;

    if (typeof obj === 'string') {
      // Check for email patterns
      if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(obj)) {
        unmaskedFields.push(`${path}: email pattern detected`);
      }

      // Check for phone patterns
      if (/\+?[\d\s\-\(\)]{10,}/.test(obj)) {
        unmaskedFields.push(`${path}: phone pattern detected`);
      }

      // Check for password patterns (should be masked)
      if (obj.length > 6 && !obj.includes('•') && !obj.includes('*') && !obj.includes('[MASKED]')) {
        if (path.toLowerCase().includes('password')) {
          unmaskedFields.push(`${path}: password appears unmasked`);
        }
      }
    }

    if (Array.isArray(obj)) {
      obj.forEach((item, index) => checkObject(item, `${path}[${index}]`));
    }

    if (typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        checkObject(value, path ? `${path}.${key}` : key);
      }
    }
  }

  checkObject(obj);

  return {
    hasUnmaskedPII: unmaskedFields.length > 0,
    unmaskedFields,
  };
}
