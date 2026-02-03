type classNameArg = string | null | undefined | boolean;

const classNames = (...args: Array<classNameArg | classNameArg[]>): string => args
  .map((a) => {
    if (a && Array.isArray(a)) return classNames(...a);
    return typeof a === 'string' ? a : null;
  })
  .filter((a) => !!a)
  .join(' ');

export default classNames;
