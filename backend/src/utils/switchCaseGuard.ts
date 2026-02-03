export const switchCaseGuard = (_: never, errorMessage?: string) => {
  if (errorMessage) throw new Error(errorMessage);
};
