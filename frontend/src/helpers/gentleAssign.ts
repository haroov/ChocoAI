// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObject = Record<string, any>

/**
 * Overwrites in deep mode properties of source with target
 * @example
 * // { b: {ba: 1, bb: 1, bc: 1}, c: 0, a: 1 }
 * gentleAssign({b: {ba: 0, bc: 1}, c: 0}, { a: 1, b: {ba: 1, bb: 1}});
 * @returns {Object} Returns updated source object.
 */
const gentleAssign = <T = unknown>(source: AnyObject, target?: AnyObject): T => {
  const res = { ...source };

  if (!target || typeof target !== 'object') return res as T;

  Object.keys(target).forEach((k) => {
    res[k] = res[k] && typeof target[k] === 'object' && !Array.isArray(target[k])
      ? gentleAssign(res[k], target[k])
      : target[k];
  });

  return res as T;
};

export default gentleAssign;
