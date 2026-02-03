/**
 * Check if text contains RTL symbols
 * @param {string} text
 * @returns {boolean}
 */
export const containsRTL = (text: string): boolean => {
  const rtlRegex = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  return rtlRegex.test(text);
};
