export const validateField = (key: string, value: any, confidence?: number): {
  valid: boolean;
  reason?:
    | 'regex_failed'
    | 'low_confidence'
    | 'schema_missing'
    | 'api_conflict'
    | 'empty_value';
  confidence?: number;
} => {
  if (!value) {
    return { valid: false, reason: 'empty_value' };
  }

  const stringValue = String(value);

  // Check confidence thresholds
  const llmMinConfidence = 0.75;
  const userMinConfidence = 1.0;

  if (confidence !== undefined && confidence < llmMinConfidence) {
    return { valid: false, reason: 'low_confidence', confidence };
  }

  if (key === 'email') {
    const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(stringValue);
    return {
      valid: isValid,
      reason: isValid ? undefined : 'regex_failed',
      confidence,
    };
  }

  if (key === 'phone') {
    const isValid =
      /^\+?[\d\s\-\(\)]+$/.test(stringValue) && stringValue.length >= 10;
    return {
      valid: isValid,
      reason: isValid ? undefined : 'regex_failed',
      confidence,
    };
  }

  // For other fields, just check if not empty
  const isValid = stringValue.trim().length > 0;
  return {
    valid: isValid,
    reason: isValid ? undefined : 'empty_value',
    confidence,
  };
};
