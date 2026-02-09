import { c as clamp, i as isEasingArray, N as NativeAnimation, s as supportedWaapiEasing, a as supportsLinearEasing, b as isBezierDefinition, m as memo, r as resolveElements, g as getValueAsType, n as numberValueTypes, f as frame, d as cancelFrame, t as transformPropOrder, e as transformProps, h as isHTMLElement, M as MotionValue, j as isCSSVar, p as px, k as isSVGElement, l as statsBuffer, o as frameData, q as activeAnimations, u as easingDefinitionToFunction, v as interpolate, w as collectMotionValues, x as motionValue, y as isMotionValue, J as JSAnimation, z as getValueTransition$1, A as secondsToMilliseconds, B as applyGeneratorOptions, C as mapEasingToNativeEasing, D as microtask, E as removeItem, F as noop, G as stepsOrder, H as reactExports, I as useIsomorphicLayoutEffect, L as LayoutGroupContext, K as jsxRuntimeExports, O as layout, P as drag, Q as animations, R as createDomVisualElement, S as progress, T as velocityPerSecond, U as defaultOffset$1, V as supportsScrollTimeline, W as useConstant, X as invariant, Y as MotionConfigContext, Z as hasReducedMotionListener, _ as initPrefersReducedMotion, $ as prefersReducedMotion, a0 as animateVisualElement, a1 as setTarget, a2 as mixNumber, a3 as createGeneratorEasing, a4 as fillOffset, a5 as isGenerator, a6 as VisualElement, a7 as createBox, a8 as isSVGSVGElement, a9 as SVGVisualElement, aa as HTMLVisualElement, ab as visualElementStore, ac as animateSingleValue, ad as animateTarget, ae as spring, af as fillWildcards, ag as PresenceContext, ah as addDomEvent, ai as motionComponentSymbol, aj as rootProjectionNode, ak as MotionGlobalConfig, al as optimizedAppearDataId, am as startWaapiAnimation, an as getOptimisedAppearId, ao as makeUseVisualState, ap as MotionContext, aq as moveItem, ar as motion } from "./index-CSGIiAQr.js";
import { as, at, au, av, aw, ax, ay, az, aA, aB, aC, aD, aE, aF, aG, aH, aI, aJ, aK, aL, aM, aN, aO, aP, aQ, aR, aS, aT, aU, aV, aW, aX, aY, aZ, a_, a$, b0, b1, b2, b3, b4, b5, b6, b7, b8, b9, ba, bb, bc, bd, be, bf, bg, bh, bi, bj, bk, bl, bm, bn, bo, bp, bq, br, bs, bt, bu, bv, bw, bx, by, bz, bA, bB, bC, bD, bE, bF, bG, bH, bI, bJ, bK, bL, bM, bN, bO, bP, bQ, bR, bS, bT, bU, bV, bW, bX, bY, bZ, b_, b$, c0, c1, c2, c3, c4, c5, c6, c7, c8, c9, ca, cb, cc, cd, ce } from "./index-CSGIiAQr.js";
import { d as domAnimation } from "./features-animation-CAXUnWvi.js";
function formatErrorMessage(message, errorCode) {
  return errorCode ? `${message}. For more information and steps for solving, visit https://motion.dev/troubleshooting/${errorCode}` : message;
}
const warned = /* @__PURE__ */ new Set();
function hasWarned(message) {
  return warned.has(message);
}
function warnOnce(condition, message, errorCode) {
  if (condition || warned.has(message))
    return;
  console.warn(formatErrorMessage(message, errorCode));
  warned.add(message);
}
const wrap = (min, max, v) => {
  const rangeSize = max - min;
  return ((v - min) % rangeSize + rangeSize) % rangeSize + min;
};
function steps(numSteps, direction = "end") {
  return (progress2) => {
    progress2 = direction === "end" ? Math.min(progress2, 0.999) : Math.max(progress2, 1e-3);
    const expanded = progress2 * numSteps;
    const rounded = direction === "end" ? Math.floor(expanded) : Math.ceil(expanded);
    return clamp(0, 1, rounded / numSteps);
  };
}
function getEasingForSegment(easing, i) {
  return isEasingArray(easing) ? easing[wrap(0, easing.length, i)] : easing;
}
class GroupAnimation {
  constructor(animations2) {
    this.stop = () => this.runAll("stop");
    this.animations = animations2.filter(Boolean);
  }
  get finished() {
    return Promise.all(this.animations.map((animation) => animation.finished));
  }
  /**
   * TODO: Filter out cancelled or stopped animations before returning
   */
  getAll(propName) {
    return this.animations[0][propName];
  }
  setAll(propName, newValue) {
    for (let i = 0; i < this.animations.length; i++) {
      this.animations[i][propName] = newValue;
    }
  }
  attachTimeline(timeline) {
    const subscriptions = this.animations.map((animation) => animation.attachTimeline(timeline));
    return () => {
      subscriptions.forEach((cancel, i) => {
        cancel && cancel();
        this.animations[i].stop();
      });
    };
  }
  get time() {
    return this.getAll("time");
  }
  set time(time) {
    this.setAll("time", time);
  }
  get speed() {
    return this.getAll("speed");
  }
  set speed(speed) {
    this.setAll("speed", speed);
  }
  get state() {
    return this.getAll("state");
  }
  get startTime() {
    return this.getAll("startTime");
  }
  get duration() {
    return getMax(this.animations, "duration");
  }
  get iterationDuration() {
    return getMax(this.animations, "iterationDuration");
  }
  runAll(methodName) {
    this.animations.forEach((controls) => controls[methodName]());
  }
  play() {
    this.runAll("play");
  }
  pause() {
    this.runAll("pause");
  }
  cancel() {
    this.runAll("cancel");
  }
  complete() {
    this.runAll("complete");
  }
}
function getMax(animations2, propName) {
  let max = 0;
  for (let i = 0; i < animations2.length; i++) {
    const value = animations2[i][propName];
    if (value !== null && value > max) {
      max = value;
    }
  }
  return max;
}
class GroupAnimationWithThen extends GroupAnimation {
  then(onResolve, _onReject) {
    return this.finished.finally(onResolve).then(() => {
    });
  }
}
class NativeAnimationWrapper extends NativeAnimation {
  constructor(animation) {
    super();
    this.animation = animation;
    animation.onfinish = () => {
      this.finishedTime = this.time;
      this.notifyFinished();
    };
  }
}
const animationMaps = /* @__PURE__ */ new WeakMap();
const animationMapKey = (name, pseudoElement = "") => `${name}:${pseudoElement}`;
function getAnimationMap(element) {
  const map = animationMaps.get(element) || /* @__PURE__ */ new Map();
  animationMaps.set(element, map);
  return map;
}
const pxValues = /* @__PURE__ */ new Set([
  // Border props
  "borderWidth",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderRadius",
  "radius",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderBottomRightRadius",
  "borderBottomLeftRadius",
  // Positioning props
  "width",
  "maxWidth",
  "height",
  "maxHeight",
  "top",
  "right",
  "bottom",
  "left",
  // Spacing props
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  // Misc
  "backgroundPositionX",
  "backgroundPositionY"
]);
function applyPxDefaults(keyframes, name) {
  for (let i = 0; i < keyframes.length; i++) {
    if (typeof keyframes[i] === "number" && pxValues.has(name)) {
      keyframes[i] = keyframes[i] + "px";
    }
  }
}
function isWaapiSupportedEasing(easing) {
  return Boolean(typeof easing === "function" && supportsLinearEasing() || !easing || typeof easing === "string" && (easing in supportedWaapiEasing || supportsLinearEasing()) || isBezierDefinition(easing) || Array.isArray(easing) && easing.every(isWaapiSupportedEasing));
}
const supportsPartialKeyframes = /* @__PURE__ */ memo(() => {
  try {
    document.createElement("div").animate({ opacity: [1] });
  } catch (e) {
    return false;
  }
  return true;
});
const acceleratedValues = /* @__PURE__ */ new Set([
  "opacity",
  "clipPath",
  "filter",
  "transform"
  // TODO: Can be accelerated but currently disabled until https://issues.chromium.org/issues/41491098 is resolved
  // or until we implement support for linear() easing.
  // "background-color"
]);
function camelToDash(str) {
  return str.replace(/([A-Z])/g, (match) => `-${match.toLowerCase()}`);
}
function createSelectorEffect(subjectEffect) {
  return (subject, values) => {
    const elements = resolveElements(subject);
    const subscriptions = [];
    for (const element of elements) {
      const remove = subjectEffect(element, values);
      subscriptions.push(remove);
    }
    return () => {
      for (const remove of subscriptions)
        remove();
    };
  };
}
class MotionValueState {
  constructor() {
    this.latest = {};
    this.values = /* @__PURE__ */ new Map();
  }
  set(name, value, render, computed, useDefaultValueType = true) {
    const existingValue = this.values.get(name);
    if (existingValue) {
      existingValue.onRemove();
    }
    const onChange = () => {
      const v = value.get();
      if (useDefaultValueType) {
        this.latest[name] = getValueAsType(v, numberValueTypes[name]);
      } else {
        this.latest[name] = v;
      }
      render && frame.render(render);
    };
    onChange();
    const cancelOnChange = value.on("change", onChange);
    computed && value.addDependent(computed);
    const remove = () => {
      cancelOnChange();
      render && cancelFrame(render);
      this.values.delete(name);
      computed && value.removeDependent(computed);
    };
    this.values.set(name, { value, onRemove: remove });
    return remove;
  }
  get(name) {
    return this.values.get(name)?.value;
  }
  destroy() {
    for (const value of this.values.values()) {
      value.onRemove();
    }
  }
}
function createEffect(addValue) {
  const stateCache = /* @__PURE__ */ new WeakMap();
  const subscriptions = [];
  return (subject, values) => {
    const state = stateCache.get(subject) ?? new MotionValueState();
    stateCache.set(subject, state);
    for (const key in values) {
      const value = values[key];
      const remove = addValue(subject, state, key, value);
      subscriptions.push(remove);
    }
    return () => {
      for (const cancel of subscriptions)
        cancel();
    };
  };
}
function canSetAsProperty(element, name) {
  if (!(name in element))
    return false;
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), name) || Object.getOwnPropertyDescriptor(element, name);
  return descriptor && typeof descriptor.set === "function";
}
const addAttrValue = (element, state, key, value) => {
  const isProp = canSetAsProperty(element, key);
  const name = isProp ? key : key.startsWith("data") || key.startsWith("aria") ? camelToDash(key) : key;
  const render = isProp ? () => {
    element[name] = state.latest[key];
  } : () => {
    const v = state.latest[key];
    if (v === null || v === void 0) {
      element.removeAttribute(name);
    } else {
      element.setAttribute(name, String(v));
    }
  };
  return state.set(key, value, render);
};
const attrEffect = /* @__PURE__ */ createSelectorEffect(
  /* @__PURE__ */ createEffect(addAttrValue)
);
const propEffect = /* @__PURE__ */ createEffect((subject, state, key, value) => {
  return state.set(key, value, () => {
    subject[key] = state.latest[key];
  }, void 0, false);
});
const translateAlias = {
  x: "translateX",
  y: "translateY",
  z: "translateZ",
  transformPerspective: "perspective"
};
function buildTransform(state) {
  let transform2 = "";
  let transformIsDefault = true;
  for (let i = 0; i < transformPropOrder.length; i++) {
    const key = transformPropOrder[i];
    const value = state.latest[key];
    if (value === void 0)
      continue;
    let valueIsDefault = true;
    if (typeof value === "number") {
      valueIsDefault = value === (key.startsWith("scale") ? 1 : 0);
    } else {
      valueIsDefault = parseFloat(value) === 0;
    }
    if (!valueIsDefault) {
      transformIsDefault = false;
      const transformName = translateAlias[key] || key;
      const valueToRender = state.latest[key];
      transform2 += `${transformName}(${valueToRender}) `;
    }
  }
  return transformIsDefault ? "none" : transform2.trim();
}
const originProps = /* @__PURE__ */ new Set(["originX", "originY", "originZ"]);
const addStyleValue = (element, state, key, value) => {
  let render = void 0;
  let computed = void 0;
  if (transformProps.has(key)) {
    if (!state.get("transform")) {
      if (!isHTMLElement(element) && !state.get("transformBox")) {
        addStyleValue(element, state, "transformBox", new MotionValue("fill-box"));
      }
      state.set("transform", new MotionValue("none"), () => {
        element.style.transform = buildTransform(state);
      });
    }
    computed = state.get("transform");
  } else if (originProps.has(key)) {
    if (!state.get("transformOrigin")) {
      state.set("transformOrigin", new MotionValue(""), () => {
        const originX = state.latest.originX ?? "50%";
        const originY = state.latest.originY ?? "50%";
        const originZ = state.latest.originZ ?? 0;
        element.style.transformOrigin = `${originX} ${originY} ${originZ}`;
      });
    }
    computed = state.get("transformOrigin");
  } else if (isCSSVar(key)) {
    render = () => {
      element.style.setProperty(key, state.latest[key]);
    };
  } else {
    render = () => {
      element.style[key] = state.latest[key];
    };
  }
  return state.set(key, value, render, computed);
};
const styleEffect = /* @__PURE__ */ createSelectorEffect(
  /* @__PURE__ */ createEffect(addStyleValue)
);
const toPx = px.transform;
function addSVGPathValue(element, state, key, value) {
  frame.render(() => element.setAttribute("pathLength", "1"));
  if (key === "pathOffset") {
    return state.set(key, value, () => element.setAttribute("stroke-dashoffset", toPx(-state.latest[key])));
  } else {
    if (!state.get("stroke-dasharray")) {
      state.set("stroke-dasharray", new MotionValue("1 1"), () => {
        const { pathLength = 1, pathSpacing } = state.latest;
        element.setAttribute("stroke-dasharray", `${toPx(pathLength)} ${toPx(pathSpacing ?? 1 - Number(pathLength))}`);
      });
    }
    return state.set(key, value, void 0, state.get("stroke-dasharray"));
  }
}
const addSVGValue = (element, state, key, value) => {
  if (key.startsWith("path")) {
    return addSVGPathValue(element, state, key, value);
  } else if (key.startsWith("attr")) {
    return addAttrValue(element, state, convertAttrKey(key), value);
  }
  const handler = key in element.style ? addStyleValue : addAttrValue;
  return handler(element, state, key, value);
};
const svgEffect = /* @__PURE__ */ createSelectorEffect(
  /* @__PURE__ */ createEffect(addSVGValue)
);
function convertAttrKey(key) {
  return key.replace(/^attr([A-Z])/, (_, firstChar) => firstChar.toLowerCase());
}
function getComputedStyle$1(element, name) {
  const computedStyle = window.getComputedStyle(element);
  return isCSSVar(name) ? computedStyle.getPropertyValue(name) : computedStyle[name];
}
const resizeHandlers = /* @__PURE__ */ new WeakMap();
let observer;
const getSize = (borderBoxAxis, svgAxis, htmlAxis) => (target, borderBoxSize) => {
  if (borderBoxSize && borderBoxSize[0]) {
    return borderBoxSize[0][borderBoxAxis + "Size"];
  } else if (isSVGElement(target) && "getBBox" in target) {
    return target.getBBox()[svgAxis];
  } else {
    return target[htmlAxis];
  }
};
const getWidth = /* @__PURE__ */ getSize("inline", "width", "offsetWidth");
const getHeight = /* @__PURE__ */ getSize("block", "height", "offsetHeight");
function notifyTarget({ target, borderBoxSize }) {
  resizeHandlers.get(target)?.forEach((handler) => {
    handler(target, {
      get width() {
        return getWidth(target, borderBoxSize);
      },
      get height() {
        return getHeight(target, borderBoxSize);
      }
    });
  });
}
function notifyAll(entries) {
  entries.forEach(notifyTarget);
}
function createResizeObserver() {
  if (typeof ResizeObserver === "undefined")
    return;
  observer = new ResizeObserver(notifyAll);
}
function resizeElement(target, handler) {
  if (!observer)
    createResizeObserver();
  const elements = resolveElements(target);
  elements.forEach((element) => {
    let elementHandlers = resizeHandlers.get(element);
    if (!elementHandlers) {
      elementHandlers = /* @__PURE__ */ new Set();
      resizeHandlers.set(element, elementHandlers);
    }
    elementHandlers.add(handler);
    observer?.observe(element);
  });
  return () => {
    elements.forEach((element) => {
      const elementHandlers = resizeHandlers.get(element);
      elementHandlers?.delete(handler);
      if (!elementHandlers?.size) {
        observer?.unobserve(element);
      }
    });
  };
}
const windowCallbacks = /* @__PURE__ */ new Set();
let windowResizeHandler;
function createWindowResizeHandler() {
  windowResizeHandler = () => {
    const info = {
      get width() {
        return window.innerWidth;
      },
      get height() {
        return window.innerHeight;
      }
    };
    windowCallbacks.forEach((callback) => callback(info));
  };
  window.addEventListener("resize", windowResizeHandler);
}
function resizeWindow(callback) {
  windowCallbacks.add(callback);
  if (!windowResizeHandler)
    createWindowResizeHandler();
  return () => {
    windowCallbacks.delete(callback);
    if (!windowCallbacks.size && typeof windowResizeHandler === "function") {
      window.removeEventListener("resize", windowResizeHandler);
      windowResizeHandler = void 0;
    }
  };
}
function resize(a, b) {
  return typeof a === "function" ? resizeWindow(a) : resizeElement(a, b);
}
function observeTimeline(update, timeline) {
  let prevProgress;
  const onFrame = () => {
    const { currentTime } = timeline;
    const percentage = currentTime === null ? 0 : currentTime.value;
    const progress2 = percentage / 100;
    if (prevProgress !== progress2) {
      update(progress2);
    }
    prevProgress = progress2;
  };
  frame.preUpdate(onFrame, true);
  return () => cancelFrame(onFrame);
}
function record() {
  const { value } = statsBuffer;
  if (value === null) {
    cancelFrame(record);
    return;
  }
  value.frameloop.rate.push(frameData.delta);
  value.animations.mainThread.push(activeAnimations.mainThread);
  value.animations.waapi.push(activeAnimations.waapi);
  value.animations.layout.push(activeAnimations.layout);
}
function mean(values) {
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}
function summarise(values, calcAverage = mean) {
  if (values.length === 0) {
    return {
      min: 0,
      max: 0,
      avg: 0
    };
  }
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: calcAverage(values)
  };
}
const msToFps = (ms) => Math.round(1e3 / ms);
function clearStatsBuffer() {
  statsBuffer.value = null;
  statsBuffer.addProjectionMetrics = null;
}
function reportStats() {
  const { value } = statsBuffer;
  if (!value) {
    throw new Error("Stats are not being measured");
  }
  clearStatsBuffer();
  cancelFrame(record);
  const summary = {
    frameloop: {
      setup: summarise(value.frameloop.setup),
      rate: summarise(value.frameloop.rate),
      read: summarise(value.frameloop.read),
      resolveKeyframes: summarise(value.frameloop.resolveKeyframes),
      preUpdate: summarise(value.frameloop.preUpdate),
      update: summarise(value.frameloop.update),
      preRender: summarise(value.frameloop.preRender),
      render: summarise(value.frameloop.render),
      postRender: summarise(value.frameloop.postRender)
    },
    animations: {
      mainThread: summarise(value.animations.mainThread),
      waapi: summarise(value.animations.waapi),
      layout: summarise(value.animations.layout)
    },
    layoutProjection: {
      nodes: summarise(value.layoutProjection.nodes),
      calculatedTargetDeltas: summarise(value.layoutProjection.calculatedTargetDeltas),
      calculatedProjections: summarise(value.layoutProjection.calculatedProjections)
    }
  };
  const { rate } = summary.frameloop;
  rate.min = msToFps(rate.min);
  rate.max = msToFps(rate.max);
  rate.avg = msToFps(rate.avg);
  [rate.min, rate.max] = [rate.max, rate.min];
  return summary;
}
function recordStats() {
  if (statsBuffer.value) {
    clearStatsBuffer();
    throw new Error("Stats are already being measured");
  }
  const newStatsBuffer = statsBuffer;
  newStatsBuffer.value = {
    frameloop: {
      setup: [],
      rate: [],
      read: [],
      resolveKeyframes: [],
      preUpdate: [],
      update: [],
      preRender: [],
      render: [],
      postRender: []
    },
    animations: {
      mainThread: [],
      waapi: [],
      layout: []
    },
    layoutProjection: {
      nodes: [],
      calculatedTargetDeltas: [],
      calculatedProjections: []
    }
  };
  newStatsBuffer.addProjectionMetrics = (metrics) => {
    const { layoutProjection } = newStatsBuffer.value;
    layoutProjection.nodes.push(metrics.nodes);
    layoutProjection.calculatedTargetDeltas.push(metrics.calculatedTargetDeltas);
    layoutProjection.calculatedProjections.push(metrics.calculatedProjections);
  };
  frame.postRender(record, true);
  return reportStats;
}
function getOriginIndex(from, total) {
  if (from === "first") {
    return 0;
  } else {
    const lastIndex = total - 1;
    return from === "last" ? lastIndex : lastIndex / 2;
  }
}
function stagger(duration = 0.1, { startDelay = 0, from = 0, ease } = {}) {
  return (i, total) => {
    const fromIndex = typeof from === "number" ? from : getOriginIndex(from, total);
    const distance = Math.abs(fromIndex - i);
    let delay = duration * distance;
    if (ease) {
      const maxDelay = total * duration;
      const easingFunction = easingDefinitionToFunction(ease);
      delay = easingFunction(delay / maxDelay) * maxDelay;
    }
    return startDelay + delay;
  };
}
function transform(...args) {
  const useImmediate = !Array.isArray(args[0]);
  const argOffset = useImmediate ? 0 : -1;
  const inputValue = args[0 + argOffset];
  const inputRange = args[1 + argOffset];
  const outputRange = args[2 + argOffset];
  const options = args[3 + argOffset];
  const interpolator = interpolate(inputRange, outputRange, options);
  return useImmediate ? interpolator(inputValue) : interpolator;
}
function subscribeValue(inputValues, outputValue, getLatest) {
  const update = () => outputValue.set(getLatest());
  const scheduleUpdate = () => frame.preRender(update, false, true);
  const subscriptions = inputValues.map((v) => v.on("change", scheduleUpdate));
  outputValue.on("destroy", () => {
    subscriptions.forEach((unsubscribe) => unsubscribe());
    cancelFrame(update);
  });
}
function transformValue(transform2) {
  const collectedValues = [];
  collectMotionValues.current = collectedValues;
  const initialValue = transform2();
  collectMotionValues.current = void 0;
  const value = motionValue(initialValue);
  subscribeValue(collectedValues, value, transform2);
  return value;
}
function mapValue(inputValue, inputRange, outputRange, options) {
  const map = transform(inputRange, outputRange, options);
  return transformValue(() => map(inputValue.get()));
}
function springValue(source, options) {
  const initialValue = isMotionValue(source) ? source.get() : source;
  const value = motionValue(initialValue);
  attachSpring(value, source, options);
  return value;
}
function attachSpring(value, source, options) {
  const initialValue = value.get();
  let activeAnimation = null;
  let latestValue = initialValue;
  let latestSetter;
  const unit = typeof initialValue === "string" ? initialValue.replace(/[\d.-]/g, "") : void 0;
  const stopAnimation2 = () => {
    if (activeAnimation) {
      activeAnimation.stop();
      activeAnimation = null;
    }
  };
  const startAnimation = () => {
    stopAnimation2();
    activeAnimation = new JSAnimation({
      keyframes: [asNumber(value.get()), asNumber(latestValue)],
      velocity: value.getVelocity(),
      type: "spring",
      restDelta: 1e-3,
      restSpeed: 0.01,
      ...options,
      onUpdate: latestSetter
    });
  };
  value.attach((v, set) => {
    latestValue = v;
    latestSetter = (latest) => set(parseValue(latest, unit));
    frame.postRender(startAnimation);
  }, stopAnimation2);
  if (isMotionValue(source)) {
    const removeSourceOnChange = source.on("change", (v) => value.set(parseValue(v, unit)));
    const removeValueOnDestroy = value.on("destroy", removeSourceOnChange);
    return () => {
      removeSourceOnChange();
      removeValueOnDestroy();
    };
  }
  return stopAnimation2;
}
function parseValue(v, unit) {
  return unit ? v + unit : v;
}
function asNumber(v) {
  return typeof v === "number" ? v : parseFloat(v);
}
function chooseLayerType(valueName) {
  if (valueName === "layout")
    return "group";
  if (valueName === "enter" || valueName === "new")
    return "new";
  if (valueName === "exit" || valueName === "old")
    return "old";
  return "group";
}
let pendingRules = {};
let style = null;
const css = {
  set: (selector, values) => {
    pendingRules[selector] = values;
  },
  commit: () => {
    if (!style) {
      style = document.createElement("style");
      style.id = "motion-view";
    }
    let cssText = "";
    for (const selector in pendingRules) {
      const rule = pendingRules[selector];
      cssText += `${selector} {
`;
      for (const [property, value] of Object.entries(rule)) {
        cssText += `  ${property}: ${value};
`;
      }
      cssText += "}\n";
    }
    style.textContent = cssText;
    document.head.appendChild(style);
    pendingRules = {};
  },
  remove: () => {
    if (style && style.parentElement) {
      style.parentElement.removeChild(style);
    }
  }
};
function getViewAnimationLayerInfo(pseudoElement) {
  const match = pseudoElement.match(/::view-transition-(old|new|group|image-pair)\((.*?)\)/);
  if (!match)
    return null;
  return { layer: match[2], type: match[1] };
}
function filterViewAnimations(animation) {
  const { effect } = animation;
  if (!effect)
    return false;
  return effect.target === document.documentElement && effect.pseudoElement?.startsWith("::view-transition");
}
function getViewAnimations() {
  return document.getAnimations().filter(filterViewAnimations);
}
function hasTarget(target, targets) {
  return targets.has(target) && Object.keys(targets.get(target)).length > 0;
}
const definitionNames = ["layout", "enter", "exit", "new", "old"];
function startViewAnimation(builder) {
  const { update, targets, options: defaultOptions } = builder;
  if (!document.startViewTransition) {
    return new Promise(async (resolve) => {
      await update();
      resolve(new GroupAnimation([]));
    });
  }
  if (!hasTarget("root", targets)) {
    css.set(":root", {
      "view-transition-name": "none"
    });
  }
  css.set("::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*)", { "animation-timing-function": "linear !important" });
  css.commit();
  const transition = document.startViewTransition(async () => {
    await update();
  });
  transition.finished.finally(() => {
    css.remove();
  });
  return new Promise((resolve) => {
    transition.ready.then(() => {
      const generatedViewAnimations = getViewAnimations();
      const animations2 = [];
      targets.forEach((definition, target) => {
        for (const key of definitionNames) {
          if (!definition[key])
            continue;
          const { keyframes, options } = definition[key];
          for (let [valueName, valueKeyframes] of Object.entries(keyframes)) {
            if (!valueKeyframes)
              continue;
            const valueOptions = {
              ...getValueTransition$1(defaultOptions, valueName),
              ...getValueTransition$1(options, valueName)
            };
            const type = chooseLayerType(key);
            if (valueName === "opacity" && !Array.isArray(valueKeyframes)) {
              const initialValue = type === "new" ? 0 : 1;
              valueKeyframes = [initialValue, valueKeyframes];
            }
            if (typeof valueOptions.delay === "function") {
              valueOptions.delay = valueOptions.delay(0, 1);
            }
            valueOptions.duration && (valueOptions.duration = secondsToMilliseconds(valueOptions.duration));
            valueOptions.delay && (valueOptions.delay = secondsToMilliseconds(valueOptions.delay));
            const animation = new NativeAnimation({
              ...valueOptions,
              element: document.documentElement,
              name: valueName,
              pseudoElement: `::view-transition-${type}(${target})`,
              keyframes: valueKeyframes
            });
            animations2.push(animation);
          }
        }
      });
      for (const animation of generatedViewAnimations) {
        if (animation.playState === "finished")
          continue;
        const { effect } = animation;
        if (!effect || !(effect instanceof KeyframeEffect))
          continue;
        const { pseudoElement } = effect;
        if (!pseudoElement)
          continue;
        const name = getViewAnimationLayerInfo(pseudoElement);
        if (!name)
          continue;
        const targetDefinition = targets.get(name.layer);
        if (!targetDefinition) {
          const transitionName = name.type === "group" ? "layout" : "";
          let animationTransition = {
            ...getValueTransition$1(defaultOptions, transitionName)
          };
          animationTransition.duration && (animationTransition.duration = secondsToMilliseconds(animationTransition.duration));
          animationTransition = applyGeneratorOptions(animationTransition);
          const easing = mapEasingToNativeEasing(animationTransition.ease, animationTransition.duration);
          effect.updateTiming({
            delay: secondsToMilliseconds(animationTransition.delay ?? 0),
            duration: animationTransition.duration,
            easing
          });
          animations2.push(new NativeAnimationWrapper(animation));
        } else if (hasOpacity(targetDefinition, "enter") && hasOpacity(targetDefinition, "exit") && effect.getKeyframes().some((keyframe) => keyframe.mixBlendMode)) {
          animations2.push(new NativeAnimationWrapper(animation));
        } else {
          animation.cancel();
        }
      }
      resolve(new GroupAnimation(animations2));
    });
  });
}
function hasOpacity(target, key) {
  return target?.[key]?.keyframes.opacity;
}
let builders = [];
let current = null;
function next() {
  current = null;
  const [nextBuilder] = builders;
  if (nextBuilder)
    start(nextBuilder);
}
function start(builder) {
  removeItem(builders, builder);
  current = builder;
  startViewAnimation(builder).then((animation) => {
    builder.notifyReady(animation);
    animation.finished.finally(next);
  });
}
function processQueue() {
  for (let i = builders.length - 1; i >= 0; i--) {
    const builder = builders[i];
    const { interrupt } = builder.options;
    if (interrupt === "immediate") {
      const batchedUpdates = builders.slice(0, i + 1).map((b) => b.update);
      const remaining = builders.slice(i + 1);
      builder.update = () => {
        batchedUpdates.forEach((update) => update());
      };
      builders = [builder, ...remaining];
      break;
    }
  }
  if (!current || builders[0]?.options.interrupt === "immediate") {
    next();
  }
}
function addToQueue(builder) {
  builders.push(builder);
  microtask.render(processQueue);
}
class ViewTransitionBuilder {
  constructor(update, options = {}) {
    this.currentSubject = "root";
    this.targets = /* @__PURE__ */ new Map();
    this.notifyReady = noop;
    this.readyPromise = new Promise((resolve) => {
      this.notifyReady = resolve;
    });
    this.update = update;
    this.options = {
      interrupt: "wait",
      ...options
    };
    addToQueue(this);
  }
  get(subject) {
    this.currentSubject = subject;
    return this;
  }
  layout(keyframes, options) {
    this.updateTarget("layout", keyframes, options);
    return this;
  }
  new(keyframes, options) {
    this.updateTarget("new", keyframes, options);
    return this;
  }
  old(keyframes, options) {
    this.updateTarget("old", keyframes, options);
    return this;
  }
  enter(keyframes, options) {
    this.updateTarget("enter", keyframes, options);
    return this;
  }
  exit(keyframes, options) {
    this.updateTarget("exit", keyframes, options);
    return this;
  }
  crossfade(options) {
    this.updateTarget("enter", { opacity: 1 }, options);
    this.updateTarget("exit", { opacity: 0 }, options);
    return this;
  }
  updateTarget(target, keyframes, options = {}) {
    const { currentSubject, targets } = this;
    if (!targets.has(currentSubject)) {
      targets.set(currentSubject, {});
    }
    const targetData = targets.get(currentSubject);
    targetData[target] = { keyframes, options };
  }
  then(resolve, reject) {
    return this.readyPromise.then(resolve, reject);
  }
}
function animateView(update, defaultOptions = {}) {
  return new ViewTransitionBuilder(update, defaultOptions);
}
const sync = frame;
const cancelSync = stepsOrder.reduce((acc, key) => {
  acc[key] = (process) => cancelFrame(process);
  return acc;
}, {});
const DeprecatedLayoutGroupContext = reactExports.createContext(null);
function useIsMounted() {
  const isMounted = reactExports.useRef(false);
  useIsomorphicLayoutEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);
  return isMounted;
}
function useForceUpdate() {
  const isMounted = useIsMounted();
  const [forcedRenderCount, setForcedRenderCount] = reactExports.useState(0);
  const forceRender = reactExports.useCallback(() => {
    isMounted.current && setForcedRenderCount(forcedRenderCount + 1);
  }, [forcedRenderCount]);
  const deferredForceRender = reactExports.useCallback(() => frame.postRender(forceRender), [forceRender]);
  return [deferredForceRender, forcedRenderCount];
}
const notify = (node) => !node.isLayoutDirty && node.willUpdate(false);
function nodeGroup() {
  const nodes = /* @__PURE__ */ new Set();
  const subscriptions = /* @__PURE__ */ new WeakMap();
  const dirtyAll = () => nodes.forEach(notify);
  return {
    add: (node) => {
      nodes.add(node);
      subscriptions.set(node, node.addEventListener("willUpdate", dirtyAll));
    },
    remove: (node) => {
      nodes.delete(node);
      const unsubscribe = subscriptions.get(node);
      if (unsubscribe) {
        unsubscribe();
        subscriptions.delete(node);
      }
      dirtyAll();
    },
    dirty: dirtyAll
  };
}
const shouldInheritGroup = (inherit) => inherit === true;
const shouldInheritId = (inherit) => shouldInheritGroup(inherit === true) || inherit === "id";
const LayoutGroup = ({ children, id: id2, inherit = true }) => {
  const layoutGroupContext = reactExports.useContext(LayoutGroupContext);
  const deprecatedLayoutGroupContext = reactExports.useContext(DeprecatedLayoutGroupContext);
  const [forceRender, key] = useForceUpdate();
  const context = reactExports.useRef(null);
  const upstreamId = layoutGroupContext.id || deprecatedLayoutGroupContext;
  if (context.current === null) {
    if (shouldInheritId(inherit) && upstreamId) {
      id2 = id2 ? upstreamId + "-" + id2 : upstreamId;
    }
    context.current = {
      id: id2,
      group: shouldInheritGroup(inherit) ? layoutGroupContext.group || nodeGroup() : nodeGroup()
    };
  }
  const memoizedContext = reactExports.useMemo(() => ({ ...context.current, forceRender }), [key]);
  return jsxRuntimeExports.jsx(LayoutGroupContext.Provider, { value: memoizedContext, children });
};
function useUnmountEffect(callback) {
  return reactExports.useEffect(() => () => callback(), []);
}
const domMax = {
  ...domAnimation,
  ...drag,
  ...layout
};
const domMin = {
  renderer: createDomVisualElement,
  ...animations
};
function useMotionValueEvent(value, event, callback) {
  reactExports.useInsertionEffect(() => value.on(event, callback), [value, event, callback]);
}
const maxElapsed = 50;
const createAxisInfo = () => ({
  current: 0,
  offset: [],
  progress: 0,
  scrollLength: 0,
  targetOffset: 0,
  targetLength: 0,
  containerLength: 0,
  velocity: 0
});
const createScrollInfo = () => ({
  time: 0,
  x: createAxisInfo(),
  y: createAxisInfo()
});
const keys = {
  x: {
    length: "Width",
    position: "Left"
  },
  y: {
    length: "Height",
    position: "Top"
  }
};
function updateAxisInfo(element, axisName, info, time) {
  const axis = info[axisName];
  const { length, position } = keys[axisName];
  const prev = axis.current;
  const prevTime = info.time;
  axis.current = element[`scroll${position}`];
  axis.scrollLength = element[`scroll${length}`] - element[`client${length}`];
  axis.offset.length = 0;
  axis.offset[0] = 0;
  axis.offset[1] = axis.scrollLength;
  axis.progress = progress(0, axis.scrollLength, axis.current);
  const elapsed = time - prevTime;
  axis.velocity = elapsed > maxElapsed ? 0 : velocityPerSecond(axis.current - prev, elapsed);
}
function updateScrollInfo(element, info, time) {
  updateAxisInfo(element, "x", info, time);
  updateAxisInfo(element, "y", info, time);
  info.time = time;
}
function calcInset(element, container) {
  const inset = { x: 0, y: 0 };
  let current2 = element;
  while (current2 && current2 !== container) {
    if (isHTMLElement(current2)) {
      inset.x += current2.offsetLeft;
      inset.y += current2.offsetTop;
      current2 = current2.offsetParent;
    } else if (current2.tagName === "svg") {
      const svgBoundingBox = current2.getBoundingClientRect();
      current2 = current2.parentElement;
      const parentBoundingBox = current2.getBoundingClientRect();
      inset.x += svgBoundingBox.left - parentBoundingBox.left;
      inset.y += svgBoundingBox.top - parentBoundingBox.top;
    } else if (current2 instanceof SVGGraphicsElement) {
      const { x, y } = current2.getBBox();
      inset.x += x;
      inset.y += y;
      let svg = null;
      let parent = current2.parentNode;
      while (!svg) {
        if (parent.tagName === "svg") {
          svg = parent;
        }
        parent = current2.parentNode;
      }
      current2 = svg;
    } else {
      break;
    }
  }
  return inset;
}
const namedEdges = {
  start: 0,
  center: 0.5,
  end: 1
};
function resolveEdge(edge, length, inset = 0) {
  let delta = 0;
  if (edge in namedEdges) {
    edge = namedEdges[edge];
  }
  if (typeof edge === "string") {
    const asNumber2 = parseFloat(edge);
    if (edge.endsWith("px")) {
      delta = asNumber2;
    } else if (edge.endsWith("%")) {
      edge = asNumber2 / 100;
    } else if (edge.endsWith("vw")) {
      delta = asNumber2 / 100 * document.documentElement.clientWidth;
    } else if (edge.endsWith("vh")) {
      delta = asNumber2 / 100 * document.documentElement.clientHeight;
    } else {
      edge = asNumber2;
    }
  }
  if (typeof edge === "number") {
    delta = length * edge;
  }
  return inset + delta;
}
const defaultOffset = [0, 0];
function resolveOffset(offset, containerLength, targetLength, targetInset) {
  let offsetDefinition = Array.isArray(offset) ? offset : defaultOffset;
  let targetPoint = 0;
  let containerPoint = 0;
  if (typeof offset === "number") {
    offsetDefinition = [offset, offset];
  } else if (typeof offset === "string") {
    offset = offset.trim();
    if (offset.includes(" ")) {
      offsetDefinition = offset.split(" ");
    } else {
      offsetDefinition = [offset, namedEdges[offset] ? offset : `0`];
    }
  }
  targetPoint = resolveEdge(offsetDefinition[0], targetLength, targetInset);
  containerPoint = resolveEdge(offsetDefinition[1], containerLength);
  return targetPoint - containerPoint;
}
const ScrollOffset = {
  All: [
    [0, 0],
    [1, 1]
  ]
};
const point = { x: 0, y: 0 };
function getTargetSize(target) {
  return "getBBox" in target && target.tagName !== "svg" ? target.getBBox() : { width: target.clientWidth, height: target.clientHeight };
}
function resolveOffsets(container, info, options) {
  const { offset: offsetDefinition = ScrollOffset.All } = options;
  const { target = container, axis = "y" } = options;
  const lengthLabel = axis === "y" ? "height" : "width";
  const inset = target !== container ? calcInset(target, container) : point;
  const targetSize = target === container ? { width: container.scrollWidth, height: container.scrollHeight } : getTargetSize(target);
  const containerSize = {
    width: container.clientWidth,
    height: container.clientHeight
  };
  info[axis].offset.length = 0;
  let hasChanged = !info[axis].interpolate;
  const numOffsets = offsetDefinition.length;
  for (let i = 0; i < numOffsets; i++) {
    const offset = resolveOffset(offsetDefinition[i], containerSize[lengthLabel], targetSize[lengthLabel], inset[axis]);
    if (!hasChanged && offset !== info[axis].interpolatorOffsets[i]) {
      hasChanged = true;
    }
    info[axis].offset[i] = offset;
  }
  if (hasChanged) {
    info[axis].interpolate = interpolate(info[axis].offset, defaultOffset$1(offsetDefinition), { clamp: false });
    info[axis].interpolatorOffsets = [...info[axis].offset];
  }
  info[axis].progress = clamp(0, 1, info[axis].interpolate(info[axis].current));
}
function measure(container, target = container, info) {
  info.x.targetOffset = 0;
  info.y.targetOffset = 0;
  if (target !== container) {
    let node = target;
    while (node && node !== container) {
      info.x.targetOffset += node.offsetLeft;
      info.y.targetOffset += node.offsetTop;
      node = node.offsetParent;
    }
  }
  info.x.targetLength = target === container ? target.scrollWidth : target.clientWidth;
  info.y.targetLength = target === container ? target.scrollHeight : target.clientHeight;
  info.x.containerLength = container.clientWidth;
  info.y.containerLength = container.clientHeight;
}
function createOnScrollHandler(element, onScroll, info, options = {}) {
  return {
    measure: (time) => {
      measure(element, options.target, info);
      updateScrollInfo(element, info, time);
      if (options.offset || options.target) {
        resolveOffsets(element, info, options);
      }
    },
    notify: () => onScroll(info)
  };
}
const scrollListeners = /* @__PURE__ */ new WeakMap();
const resizeListeners = /* @__PURE__ */ new WeakMap();
const onScrollHandlers = /* @__PURE__ */ new WeakMap();
const getEventTarget = (element) => element === document.scrollingElement ? window : element;
function scrollInfo(onScroll, { container = document.scrollingElement, ...options } = {}) {
  if (!container)
    return noop;
  let containerHandlers = onScrollHandlers.get(container);
  if (!containerHandlers) {
    containerHandlers = /* @__PURE__ */ new Set();
    onScrollHandlers.set(container, containerHandlers);
  }
  const info = createScrollInfo();
  const containerHandler = createOnScrollHandler(container, onScroll, info, options);
  containerHandlers.add(containerHandler);
  if (!scrollListeners.has(container)) {
    const measureAll = () => {
      for (const handler of containerHandlers) {
        handler.measure(frameData.timestamp);
      }
      frame.preUpdate(notifyAll2);
    };
    const notifyAll2 = () => {
      for (const handler of containerHandlers) {
        handler.notify();
      }
    };
    const listener2 = () => frame.read(measureAll);
    scrollListeners.set(container, listener2);
    const target = getEventTarget(container);
    window.addEventListener("resize", listener2, { passive: true });
    if (container !== document.documentElement) {
      resizeListeners.set(container, resize(container, listener2));
    }
    target.addEventListener("scroll", listener2, { passive: true });
    listener2();
  }
  const listener = scrollListeners.get(container);
  frame.read(listener, false, true);
  return () => {
    cancelFrame(listener);
    const currentHandlers = onScrollHandlers.get(container);
    if (!currentHandlers)
      return;
    currentHandlers.delete(containerHandler);
    if (currentHandlers.size)
      return;
    const scrollListener = scrollListeners.get(container);
    scrollListeners.delete(container);
    if (scrollListener) {
      getEventTarget(container).removeEventListener("scroll", scrollListener);
      resizeListeners.get(container)?.();
      window.removeEventListener("resize", scrollListener);
    }
  };
}
const timelineCache = /* @__PURE__ */ new Map();
function scrollTimelineFallback(options) {
  const currentTime = { value: 0 };
  const cancel = scrollInfo((info) => {
    currentTime.value = info[options.axis].progress * 100;
  }, options);
  return { currentTime, cancel };
}
function getTimeline({ source, container, ...options }) {
  const { axis } = options;
  if (source)
    container = source;
  const containerCache = timelineCache.get(container) ?? /* @__PURE__ */ new Map();
  timelineCache.set(container, containerCache);
  const targetKey = options.target ?? "self";
  const targetCache = containerCache.get(targetKey) ?? {};
  const axisKey = axis + (options.offset ?? []).join(",");
  if (!targetCache[axisKey]) {
    targetCache[axisKey] = !options.target && supportsScrollTimeline() ? new ScrollTimeline({ source: container, axis }) : scrollTimelineFallback({ container, ...options });
  }
  return targetCache[axisKey];
}
function attachToAnimation(animation, options) {
  const timeline = getTimeline(options);
  return animation.attachTimeline({
    timeline: options.target ? void 0 : timeline,
    observe: (valueAnimation) => {
      valueAnimation.pause();
      return observeTimeline((progress2) => {
        valueAnimation.time = valueAnimation.iterationDuration * progress2;
      }, timeline);
    }
  });
}
function isOnScrollWithInfo(onScroll) {
  return onScroll.length === 2;
}
function attachToFunction(onScroll, options) {
  if (isOnScrollWithInfo(onScroll)) {
    return scrollInfo((info) => {
      onScroll(info[options.axis].progress, info);
    }, options);
  } else {
    return observeTimeline(onScroll, getTimeline(options));
  }
}
function scroll(onScroll, { axis = "y", container = document.scrollingElement, ...options } = {}) {
  if (!container)
    return noop;
  const optionsWithDefaults = { axis, container, ...options };
  return typeof onScroll === "function" ? attachToFunction(onScroll, optionsWithDefaults) : attachToAnimation(onScroll, optionsWithDefaults);
}
const createScrollMotionValues = () => ({
  scrollX: motionValue(0),
  scrollY: motionValue(0),
  scrollXProgress: motionValue(0),
  scrollYProgress: motionValue(0)
});
const isRefPending = (ref) => {
  if (!ref)
    return false;
  return !ref.current;
};
function useScroll({ container, target, ...options } = {}) {
  const values = useConstant(createScrollMotionValues);
  const scrollAnimation = reactExports.useRef(null);
  const needsStart = reactExports.useRef(false);
  const start2 = reactExports.useCallback(() => {
    scrollAnimation.current = scroll((_progress, { x, y }) => {
      values.scrollX.set(x.current);
      values.scrollXProgress.set(x.progress);
      values.scrollY.set(y.current);
      values.scrollYProgress.set(y.progress);
    }, {
      ...options,
      container: container?.current || void 0,
      target: target?.current || void 0
    });
    return () => {
      scrollAnimation.current?.();
    };
  }, [container, target, JSON.stringify(options.offset)]);
  useIsomorphicLayoutEffect(() => {
    needsStart.current = false;
    if (isRefPending(container) || isRefPending(target)) {
      needsStart.current = true;
      return;
    } else {
      return start2();
    }
  }, [start2]);
  reactExports.useEffect(() => {
    if (needsStart.current) {
      invariant(!isRefPending(container));
      invariant(!isRefPending(target));
      return start2();
    } else {
      return;
    }
  }, [start2]);
  return values;
}
function useElementScroll(ref) {
  return useScroll({ container: ref });
}
function useViewportScroll() {
  return useScroll();
}
function useMotionValue(initial) {
  const value = useConstant(() => motionValue(initial));
  const { isStatic } = reactExports.useContext(MotionConfigContext);
  if (isStatic) {
    const [, setLatest] = reactExports.useState(initial);
    reactExports.useEffect(() => value.on("change", setLatest), []);
  }
  return value;
}
function useCombineMotionValues(values, combineValues) {
  const value = useMotionValue(combineValues());
  const updateValue = () => value.set(combineValues());
  updateValue();
  useIsomorphicLayoutEffect(() => {
    const scheduleUpdate = () => frame.preRender(updateValue, false, true);
    const subscriptions = values.map((v) => v.on("change", scheduleUpdate));
    return () => {
      subscriptions.forEach((unsubscribe) => unsubscribe());
      cancelFrame(updateValue);
    };
  });
  return value;
}
function useMotionTemplate(fragments, ...values) {
  const numFragments = fragments.length;
  function buildValue() {
    let output = ``;
    for (let i = 0; i < numFragments; i++) {
      output += fragments[i];
      const value = values[i];
      if (value) {
        output += isMotionValue(value) ? value.get() : value;
      }
    }
    return output;
  }
  return useCombineMotionValues(values.filter(isMotionValue), buildValue);
}
function useComputed(compute) {
  collectMotionValues.current = [];
  compute();
  const value = useCombineMotionValues(collectMotionValues.current, compute);
  collectMotionValues.current = void 0;
  return value;
}
function useTransform(input, inputRangeOrTransformer, outputRange, options) {
  if (typeof input === "function") {
    return useComputed(input);
  }
  const transformer = typeof inputRangeOrTransformer === "function" ? inputRangeOrTransformer : transform(inputRangeOrTransformer, outputRange, options);
  return Array.isArray(input) ? useListTransform(input, transformer) : useListTransform([input], ([latest]) => transformer(latest));
}
function useListTransform(values, transformer) {
  const latest = useConstant(() => []);
  return useCombineMotionValues(values, () => {
    latest.length = 0;
    const numValues = values.length;
    for (let i = 0; i < numValues; i++) {
      latest[i] = values[i].get();
    }
    return transformer(latest);
  });
}
function useSpring(source, options = {}) {
  const { isStatic } = reactExports.useContext(MotionConfigContext);
  const getFromSource = () => isMotionValue(source) ? source.get() : source;
  if (isStatic) {
    return useTransform(getFromSource);
  }
  const value = useMotionValue(getFromSource());
  reactExports.useInsertionEffect(() => {
    return attachSpring(value, source, options);
  }, [value, JSON.stringify(options)]);
  return value;
}
function useAnimationFrame(callback) {
  const initialTimestamp = reactExports.useRef(0);
  const { isStatic } = reactExports.useContext(MotionConfigContext);
  reactExports.useEffect(() => {
    if (isStatic)
      return;
    const provideTimeSinceStart = ({ timestamp, delta }) => {
      if (!initialTimestamp.current)
        initialTimestamp.current = timestamp;
      callback(timestamp - initialTimestamp.current, delta);
    };
    frame.update(provideTimeSinceStart, true);
    return () => cancelFrame(provideTimeSinceStart);
  }, [callback]);
}
function useTime() {
  const time = useMotionValue(0);
  useAnimationFrame((t) => time.set(t));
  return time;
}
function useVelocity(value) {
  const velocity = useMotionValue(value.getVelocity());
  const updateVelocity = () => {
    const latest = value.getVelocity();
    velocity.set(latest);
    if (latest)
      frame.update(updateVelocity);
  };
  useMotionValueEvent(value, "change", () => {
    frame.update(updateVelocity, false, true);
  });
  return velocity;
}
class WillChangeMotionValue extends MotionValue {
  constructor() {
    super(...arguments);
    this.isEnabled = false;
  }
  add(name) {
    if (transformProps.has(name) || acceleratedValues.has(name)) {
      this.isEnabled = true;
      this.update();
    }
  }
  update() {
    this.set(this.isEnabled ? "transform" : "auto");
  }
}
function useWillChange() {
  return useConstant(() => new WillChangeMotionValue("auto"));
}
function useReducedMotion() {
  !hasReducedMotionListener.current && initPrefersReducedMotion();
  const [shouldReduceMotion] = reactExports.useState(prefersReducedMotion.current);
  return shouldReduceMotion;
}
function useReducedMotionConfig() {
  const reducedMotionPreference = useReducedMotion();
  const { reducedMotion } = reactExports.useContext(MotionConfigContext);
  if (reducedMotion === "never") {
    return false;
  } else if (reducedMotion === "always") {
    return true;
  } else {
    return reducedMotionPreference;
  }
}
function stopAnimation(visualElement) {
  visualElement.values.forEach((value) => value.stop());
}
function setVariants(visualElement, variantLabels) {
  const reversedLabels = [...variantLabels].reverse();
  reversedLabels.forEach((key) => {
    const variant = visualElement.getVariant(key);
    variant && setTarget(visualElement, variant);
    if (visualElement.variantChildren) {
      visualElement.variantChildren.forEach((child) => {
        setVariants(child, variantLabels);
      });
    }
  });
}
function setValues(visualElement, definition) {
  if (Array.isArray(definition)) {
    return setVariants(visualElement, definition);
  } else if (typeof definition === "string") {
    return setVariants(visualElement, [definition]);
  } else {
    setTarget(visualElement, definition);
  }
}
function animationControls() {
  const subscribers = /* @__PURE__ */ new Set();
  const controls = {
    subscribe(visualElement) {
      subscribers.add(visualElement);
      return () => void subscribers.delete(visualElement);
    },
    start(definition, transitionOverride) {
      const animations2 = [];
      subscribers.forEach((visualElement) => {
        animations2.push(animateVisualElement(visualElement, definition, {
          transitionOverride
        }));
      });
      return Promise.all(animations2);
    },
    set(definition) {
      return subscribers.forEach((visualElement) => {
        setValues(visualElement, definition);
      });
    },
    stop() {
      subscribers.forEach((visualElement) => {
        stopAnimation(visualElement);
      });
    },
    mount() {
      return () => {
        controls.stop();
      };
    }
  };
  return controls;
}
function isDOMKeyframes(keyframes) {
  return typeof keyframes === "object" && !Array.isArray(keyframes);
}
function resolveSubjects(subject, keyframes, scope, selectorCache) {
  if (typeof subject === "string" && isDOMKeyframes(keyframes)) {
    return resolveElements(subject, scope, selectorCache);
  } else if (subject instanceof NodeList) {
    return Array.from(subject);
  } else if (Array.isArray(subject)) {
    return subject;
  } else {
    return [subject];
  }
}
function calculateRepeatDuration(duration, repeat, _repeatDelay) {
  return duration * (repeat + 1);
}
function calcNextTime(current2, next2, prev, labels) {
  if (typeof next2 === "number") {
    return next2;
  } else if (next2.startsWith("-") || next2.startsWith("+")) {
    return Math.max(0, current2 + parseFloat(next2));
  } else if (next2 === "<") {
    return prev;
  } else if (next2.startsWith("<")) {
    return Math.max(0, prev + parseFloat(next2.slice(1)));
  } else {
    return labels.get(next2) ?? current2;
  }
}
function eraseKeyframes(sequence, startTime, endTime) {
  for (let i = 0; i < sequence.length; i++) {
    const keyframe = sequence[i];
    if (keyframe.at > startTime && keyframe.at < endTime) {
      removeItem(sequence, keyframe);
      i--;
    }
  }
}
function addKeyframes(sequence, keyframes, easing, offset, startTime, endTime) {
  eraseKeyframes(sequence, startTime, endTime);
  for (let i = 0; i < keyframes.length; i++) {
    sequence.push({
      value: keyframes[i],
      at: mixNumber(startTime, endTime, offset[i]),
      easing: getEasingForSegment(easing, i)
    });
  }
}
function normalizeTimes(times, repeat) {
  for (let i = 0; i < times.length; i++) {
    times[i] = times[i] / (repeat + 1);
  }
}
function compareByTime(a, b) {
  if (a.at === b.at) {
    if (a.value === null)
      return 1;
    if (b.value === null)
      return -1;
    return 0;
  } else {
    return a.at - b.at;
  }
}
const defaultSegmentEasing = "easeInOut";
function createAnimationsFromSequence(sequence, { defaultTransition = {}, ...sequenceTransition } = {}, scope, generators) {
  const defaultDuration = defaultTransition.duration || 0.3;
  const animationDefinitions = /* @__PURE__ */ new Map();
  const sequences = /* @__PURE__ */ new Map();
  const elementCache = {};
  const timeLabels = /* @__PURE__ */ new Map();
  let prevTime = 0;
  let currentTime = 0;
  let totalDuration = 0;
  for (let i = 0; i < sequence.length; i++) {
    const segment = sequence[i];
    if (typeof segment === "string") {
      timeLabels.set(segment, currentTime);
      continue;
    } else if (!Array.isArray(segment)) {
      timeLabels.set(segment.name, calcNextTime(currentTime, segment.at, prevTime, timeLabels));
      continue;
    }
    let [subject, keyframes, transition = {}] = segment;
    if (transition.at !== void 0) {
      currentTime = calcNextTime(currentTime, transition.at, prevTime, timeLabels);
    }
    let maxDuration = 0;
    const resolveValueSequence = (valueKeyframes, valueTransition, valueSequence, elementIndex = 0, numSubjects = 0) => {
      const valueKeyframesAsList = keyframesAsList(valueKeyframes);
      const { delay = 0, times = defaultOffset$1(valueKeyframesAsList), type = "keyframes", repeat, repeatType, repeatDelay = 0, ...remainingTransition } = valueTransition;
      let { ease = defaultTransition.ease || "easeOut", duration } = valueTransition;
      const calculatedDelay = typeof delay === "function" ? delay(elementIndex, numSubjects) : delay;
      const numKeyframes = valueKeyframesAsList.length;
      const createGenerator = isGenerator(type) ? type : generators?.[type || "keyframes"];
      if (numKeyframes <= 2 && createGenerator) {
        let absoluteDelta = 100;
        if (numKeyframes === 2 && isNumberKeyframesArray(valueKeyframesAsList)) {
          const delta = valueKeyframesAsList[1] - valueKeyframesAsList[0];
          absoluteDelta = Math.abs(delta);
        }
        const springTransition = { ...remainingTransition };
        if (duration !== void 0) {
          springTransition.duration = secondsToMilliseconds(duration);
        }
        const springEasing = createGeneratorEasing(springTransition, absoluteDelta, createGenerator);
        ease = springEasing.ease;
        duration = springEasing.duration;
      }
      duration ?? (duration = defaultDuration);
      const startTime = currentTime + calculatedDelay;
      if (times.length === 1 && times[0] === 0) {
        times[1] = 1;
      }
      const remainder = times.length - valueKeyframesAsList.length;
      remainder > 0 && fillOffset(times, remainder);
      valueKeyframesAsList.length === 1 && valueKeyframesAsList.unshift(null);
      if (repeat) {
        duration = calculateRepeatDuration(duration, repeat);
        const originalKeyframes = [...valueKeyframesAsList];
        const originalTimes = [...times];
        ease = Array.isArray(ease) ? [...ease] : [ease];
        const originalEase = [...ease];
        for (let repeatIndex = 0; repeatIndex < repeat; repeatIndex++) {
          valueKeyframesAsList.push(...originalKeyframes);
          for (let keyframeIndex = 0; keyframeIndex < originalKeyframes.length; keyframeIndex++) {
            times.push(originalTimes[keyframeIndex] + (repeatIndex + 1));
            ease.push(keyframeIndex === 0 ? "linear" : getEasingForSegment(originalEase, keyframeIndex - 1));
          }
        }
        normalizeTimes(times, repeat);
      }
      const targetTime = startTime + duration;
      addKeyframes(valueSequence, valueKeyframesAsList, ease, times, startTime, targetTime);
      maxDuration = Math.max(calculatedDelay + duration, maxDuration);
      totalDuration = Math.max(targetTime, totalDuration);
    };
    if (isMotionValue(subject)) {
      const subjectSequence = getSubjectSequence(subject, sequences);
      resolveValueSequence(keyframes, transition, getValueSequence("default", subjectSequence));
    } else {
      const subjects = resolveSubjects(subject, keyframes, scope, elementCache);
      const numSubjects = subjects.length;
      for (let subjectIndex = 0; subjectIndex < numSubjects; subjectIndex++) {
        keyframes = keyframes;
        transition = transition;
        const thisSubject = subjects[subjectIndex];
        const subjectSequence = getSubjectSequence(thisSubject, sequences);
        for (const key in keyframes) {
          resolveValueSequence(keyframes[key], getValueTransition(transition, key), getValueSequence(key, subjectSequence), subjectIndex, numSubjects);
        }
      }
    }
    prevTime = currentTime;
    currentTime += maxDuration;
  }
  sequences.forEach((valueSequences, element) => {
    for (const key in valueSequences) {
      const valueSequence = valueSequences[key];
      valueSequence.sort(compareByTime);
      const keyframes = [];
      const valueOffset = [];
      const valueEasing = [];
      for (let i = 0; i < valueSequence.length; i++) {
        const { at: at2, value, easing } = valueSequence[i];
        keyframes.push(value);
        valueOffset.push(progress(0, totalDuration, at2));
        valueEasing.push(easing || "easeOut");
      }
      if (valueOffset[0] !== 0) {
        valueOffset.unshift(0);
        keyframes.unshift(keyframes[0]);
        valueEasing.unshift(defaultSegmentEasing);
      }
      if (valueOffset[valueOffset.length - 1] !== 1) {
        valueOffset.push(1);
        keyframes.push(null);
      }
      if (!animationDefinitions.has(element)) {
        animationDefinitions.set(element, {
          keyframes: {},
          transition: {}
        });
      }
      const definition = animationDefinitions.get(element);
      definition.keyframes[key] = keyframes;
      definition.transition[key] = {
        ...defaultTransition,
        duration: totalDuration,
        ease: valueEasing,
        times: valueOffset,
        ...sequenceTransition
      };
    }
  });
  return animationDefinitions;
}
function getSubjectSequence(subject, sequences) {
  !sequences.has(subject) && sequences.set(subject, {});
  return sequences.get(subject);
}
function getValueSequence(name, sequences) {
  if (!sequences[name])
    sequences[name] = [];
  return sequences[name];
}
function keyframesAsList(keyframes) {
  return Array.isArray(keyframes) ? keyframes : [keyframes];
}
function getValueTransition(transition, key) {
  return transition && transition[key] ? {
    ...transition,
    ...transition[key]
  } : { ...transition };
}
const isNumber = (keyframe) => typeof keyframe === "number";
const isNumberKeyframesArray = (keyframes) => keyframes.every(isNumber);
function isObjectKey(key, object) {
  return key in object;
}
class ObjectVisualElement extends VisualElement {
  constructor() {
    super(...arguments);
    this.type = "object";
  }
  readValueFromInstance(instance, key) {
    if (isObjectKey(key, instance)) {
      const value = instance[key];
      if (typeof value === "string" || typeof value === "number") {
        return value;
      }
    }
    return void 0;
  }
  getBaseTargetFromProps() {
    return void 0;
  }
  removeValueFromRenderState(key, renderState) {
    delete renderState.output[key];
  }
  measureInstanceViewportBox() {
    return createBox();
  }
  build(renderState, latestValues) {
    Object.assign(renderState.output, latestValues);
  }
  renderInstance(instance, { output }) {
    Object.assign(instance, output);
  }
  sortInstanceNodePosition() {
    return 0;
  }
}
function createDOMVisualElement(element) {
  const options = {
    presenceContext: null,
    props: {},
    visualState: {
      renderState: {
        transform: {},
        transformOrigin: {},
        style: {},
        vars: {},
        attrs: {}
      },
      latestValues: {}
    }
  };
  const node = isSVGElement(element) && !isSVGSVGElement(element) ? new SVGVisualElement(options) : new HTMLVisualElement(options);
  node.mount(element);
  visualElementStore.set(element, node);
}
function createObjectVisualElement(subject) {
  const options = {
    presenceContext: null,
    props: {},
    visualState: {
      renderState: {
        output: {}
      },
      latestValues: {}
    }
  };
  const node = new ObjectVisualElement(options);
  node.mount(subject);
  visualElementStore.set(subject, node);
}
function isSingleValue(subject, keyframes) {
  return isMotionValue(subject) || typeof subject === "number" || typeof subject === "string" && !isDOMKeyframes(keyframes);
}
function animateSubject(subject, keyframes, options, scope) {
  const animations2 = [];
  if (isSingleValue(subject, keyframes)) {
    animations2.push(animateSingleValue(subject, isDOMKeyframes(keyframes) ? keyframes.default || keyframes : keyframes, options ? options.default || options : options));
  } else {
    const subjects = resolveSubjects(subject, keyframes, scope);
    const numSubjects = subjects.length;
    for (let i = 0; i < numSubjects; i++) {
      const thisSubject = subjects[i];
      const createVisualElement = thisSubject instanceof Element ? createDOMVisualElement : createObjectVisualElement;
      if (!visualElementStore.has(thisSubject)) {
        createVisualElement(thisSubject);
      }
      const visualElement = visualElementStore.get(thisSubject);
      const transition = { ...options };
      if ("delay" in transition && typeof transition.delay === "function") {
        transition.delay = transition.delay(i, numSubjects);
      }
      animations2.push(...animateTarget(visualElement, { ...keyframes, transition }, {}));
    }
  }
  return animations2;
}
function animateSequence(sequence, options, scope) {
  const animations2 = [];
  const animationDefinitions = createAnimationsFromSequence(sequence, options, scope, { spring });
  animationDefinitions.forEach(({ keyframes, transition }, subject) => {
    animations2.push(...animateSubject(subject, keyframes, transition));
  });
  return animations2;
}
function isSequence(value) {
  return Array.isArray(value) && value.some(Array.isArray);
}
function createScopedAnimate(scope) {
  function scopedAnimate(subjectOrSequence, optionsOrKeyframes, options) {
    let animations2 = [];
    let animationOnComplete;
    if (isSequence(subjectOrSequence)) {
      animations2 = animateSequence(subjectOrSequence, optionsOrKeyframes, scope);
    } else {
      const { onComplete, ...rest } = options || {};
      if (typeof onComplete === "function") {
        animationOnComplete = onComplete;
      }
      animations2 = animateSubject(subjectOrSequence, optionsOrKeyframes, rest, scope);
    }
    const animation = new GroupAnimationWithThen(animations2);
    if (animationOnComplete) {
      animation.finished.then(animationOnComplete);
    }
    if (scope) {
      scope.animations.push(animation);
      animation.finished.then(() => {
        removeItem(scope.animations, animation);
      });
    }
    return animation;
  }
  return scopedAnimate;
}
const animate = createScopedAnimate();
function useAnimate() {
  const scope = useConstant(() => ({
    current: null,
    // Will be hydrated by React
    animations: []
  }));
  const animate2 = useConstant(() => createScopedAnimate(scope));
  useUnmountEffect(() => {
    scope.animations.forEach((animation) => animation.stop());
    scope.animations.length = 0;
  });
  return [scope, animate2];
}
function animateElements(elementOrSelector, keyframes, options, scope) {
  const elements = resolveElements(elementOrSelector, scope);
  const numElements = elements.length;
  const animationDefinitions = [];
  for (let i = 0; i < numElements; i++) {
    const element = elements[i];
    const elementTransition = { ...options };
    if (typeof elementTransition.delay === "function") {
      elementTransition.delay = elementTransition.delay(i, numElements);
    }
    for (const valueName in keyframes) {
      let valueKeyframes = keyframes[valueName];
      if (!Array.isArray(valueKeyframes)) {
        valueKeyframes = [valueKeyframes];
      }
      const valueOptions = {
        ...getValueTransition$1(elementTransition, valueName)
      };
      valueOptions.duration && (valueOptions.duration = secondsToMilliseconds(valueOptions.duration));
      valueOptions.delay && (valueOptions.delay = secondsToMilliseconds(valueOptions.delay));
      const map = getAnimationMap(element);
      const key = animationMapKey(valueName, valueOptions.pseudoElement || "");
      const currentAnimation = map.get(key);
      currentAnimation && currentAnimation.stop();
      animationDefinitions.push({
        map,
        key,
        unresolvedKeyframes: valueKeyframes,
        options: {
          ...valueOptions,
          element,
          name: valueName,
          allowFlatten: !elementTransition.type && !elementTransition.ease
        }
      });
    }
  }
  for (let i = 0; i < animationDefinitions.length; i++) {
    const { unresolvedKeyframes, options: animationOptions } = animationDefinitions[i];
    const { element, name, pseudoElement } = animationOptions;
    if (!pseudoElement && unresolvedKeyframes[0] === null) {
      unresolvedKeyframes[0] = getComputedStyle$1(element, name);
    }
    fillWildcards(unresolvedKeyframes);
    applyPxDefaults(unresolvedKeyframes, name);
    if (!pseudoElement && unresolvedKeyframes.length < 2) {
      unresolvedKeyframes.unshift(getComputedStyle$1(element, name));
    }
    animationOptions.keyframes = unresolvedKeyframes;
  }
  const animations2 = [];
  for (let i = 0; i < animationDefinitions.length; i++) {
    const { map, key, options: animationOptions } = animationDefinitions[i];
    const animation = new NativeAnimation(animationOptions);
    map.set(key, animation);
    animation.finished.finally(() => map.delete(key));
    animations2.push(animation);
  }
  return animations2;
}
const createScopedWaapiAnimate = (scope) => {
  function scopedAnimate(elementOrSelector, keyframes, options) {
    return new GroupAnimationWithThen(animateElements(elementOrSelector, keyframes, options, scope));
  }
  return scopedAnimate;
};
const animateMini = /* @__PURE__ */ createScopedWaapiAnimate();
function useAnimateMini() {
  const scope = useConstant(() => ({
    current: null,
    // Will be hydrated by React
    animations: []
  }));
  const animate2 = useConstant(() => createScopedWaapiAnimate(scope));
  useUnmountEffect(() => {
    scope.animations.forEach((animation) => animation.stop());
  });
  return [scope, animate2];
}
function useAnimationControls() {
  const controls = useConstant(animationControls);
  useIsomorphicLayoutEffect(controls.mount, []);
  return controls;
}
const useAnimation = useAnimationControls;
function usePresenceData() {
  const context = reactExports.useContext(PresenceContext);
  return context ? context.custom : void 0;
}
function useDomEvent(ref, eventName, handler, options) {
  reactExports.useEffect(() => {
    const element = ref.current;
    if (handler && element) {
      return addDomEvent(element, eventName, handler, options);
    }
  }, [ref, eventName, handler, options]);
}
class DragControls {
  constructor() {
    this.componentControls = /* @__PURE__ */ new Set();
  }
  /**
   * Subscribe a component's internal `VisualElementDragControls` to the user-facing API.
   *
   * @internal
   */
  subscribe(controls) {
    this.componentControls.add(controls);
    return () => this.componentControls.delete(controls);
  }
  /**
   * Start a drag gesture on every `motion` component that has this set of drag controls
   * passed into it via the `dragControls` prop.
   *
   * ```jsx
   * dragControls.start(e, {
   *   snapToCursor: true
   * })
   * ```
   *
   * @param event - PointerEvent
   * @param options - Options
   *
   * @public
   */
  start(event, options) {
    this.componentControls.forEach((controls) => {
      controls.start(event.nativeEvent || event, options);
    });
  }
  /**
   * Cancels a drag gesture.
   *
   * ```jsx
   * dragControls.cancel()
   * ```
   *
   * @public
   */
  cancel() {
    this.componentControls.forEach((controls) => {
      controls.cancel();
    });
  }
  /**
   * Stops a drag gesture.
   *
   * ```jsx
   * dragControls.stop()
   * ```
   *
   * @public
   */
  stop() {
    this.componentControls.forEach((controls) => {
      controls.stop();
    });
  }
}
const createDragControls = () => new DragControls();
function useDragControls() {
  return useConstant(createDragControls);
}
function isMotionComponent(component) {
  return component !== null && typeof component === "object" && motionComponentSymbol in component;
}
function unwrapMotionComponent(component) {
  if (isMotionComponent(component)) {
    return component[motionComponentSymbol];
  }
  return void 0;
}
function useInstantLayoutTransition() {
  return startTransition;
}
function startTransition(callback) {
  if (!rootProjectionNode.current)
    return;
  rootProjectionNode.current.isUpdating = false;
  rootProjectionNode.current.blockUpdate();
  callback && callback();
}
function useResetProjection() {
  const reset = reactExports.useCallback(() => {
    const root = rootProjectionNode.current;
    if (!root)
      return;
    root.resetTree();
  }, []);
  return reset;
}
function useCycle(...items) {
  const index = reactExports.useRef(0);
  const [item, setItem] = reactExports.useState(items[index.current]);
  const runCycle = reactExports.useCallback(
    (next2) => {
      index.current = typeof next2 !== "number" ? wrap(0, items.length, index.current + 1) : next2;
      setItem(items[index.current]);
    },
    // The array will change on each call, but by putting items.length at
    // the front of this array, we guarantee the dependency comparison will match up
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items.length, ...items]
  );
  return [item, runCycle];
}
const thresholds = {
  some: 0,
  all: 1
};
function inView(elementOrSelector, onStart, { root, margin: rootMargin, amount = "some" } = {}) {
  const elements = resolveElements(elementOrSelector);
  const activeIntersections = /* @__PURE__ */ new WeakMap();
  const onIntersectionChange = (entries) => {
    entries.forEach((entry) => {
      const onEnd = activeIntersections.get(entry.target);
      if (entry.isIntersecting === Boolean(onEnd))
        return;
      if (entry.isIntersecting) {
        const newOnEnd = onStart(entry.target, entry);
        if (typeof newOnEnd === "function") {
          activeIntersections.set(entry.target, newOnEnd);
        } else {
          observer2.unobserve(entry.target);
        }
      } else if (typeof onEnd === "function") {
        onEnd(entry);
        activeIntersections.delete(entry.target);
      }
    });
  };
  const observer2 = new IntersectionObserver(onIntersectionChange, {
    root,
    rootMargin,
    threshold: typeof amount === "number" ? amount : thresholds[amount]
  });
  elements.forEach((element) => observer2.observe(element));
  return () => observer2.disconnect();
}
function useInView(ref, { root, margin, amount, once = false, initial = false } = {}) {
  const [isInView, setInView] = reactExports.useState(initial);
  reactExports.useEffect(() => {
    if (!ref.current || once && isInView)
      return;
    const onEnter = () => {
      setInView(true);
      return once ? void 0 : () => setInView(false);
    };
    const options = {
      root: root && root.current || void 0,
      margin,
      amount
    };
    return inView(ref.current, onEnter, options);
  }, [root, ref, margin, once, amount]);
  return isInView;
}
function useInstantTransition() {
  const [forceUpdate, forcedRenderCount] = useForceUpdate();
  const startInstantLayoutTransition = useInstantLayoutTransition();
  const unlockOnFrameRef = reactExports.useRef(-1);
  reactExports.useEffect(() => {
    frame.postRender(() => frame.postRender(() => {
      if (forcedRenderCount !== unlockOnFrameRef.current)
        return;
      MotionGlobalConfig.instantAnimations = false;
    }));
  }, [forcedRenderCount]);
  return (callback) => {
    startInstantLayoutTransition(() => {
      MotionGlobalConfig.instantAnimations = true;
      forceUpdate();
      callback();
      unlockOnFrameRef.current = forcedRenderCount + 1;
    });
  };
}
function disableInstantTransitions() {
  MotionGlobalConfig.instantAnimations = false;
}
function usePageInView() {
  const [isInView, setIsInView] = reactExports.useState(true);
  reactExports.useEffect(() => {
    const handleVisibilityChange = () => setIsInView(!document.hidden);
    if (document.hidden) {
      handleVisibilityChange();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);
  return isInView;
}
const appearAnimationStore = /* @__PURE__ */ new Map();
const appearComplete = /* @__PURE__ */ new Map();
const appearStoreId = (elementId, valueName) => {
  const key = transformProps.has(valueName) ? "transform" : valueName;
  return `${elementId}: ${key}`;
};
function handoffOptimizedAppearAnimation(elementId, valueName, frame2) {
  const storeId = appearStoreId(elementId, valueName);
  const optimisedAnimation = appearAnimationStore.get(storeId);
  if (!optimisedAnimation) {
    return null;
  }
  const { animation, startTime } = optimisedAnimation;
  function cancelAnimation() {
    window.MotionCancelOptimisedAnimation?.(elementId, valueName, frame2);
  }
  animation.onfinish = cancelAnimation;
  if (startTime === null || window.MotionHandoffIsComplete?.(elementId)) {
    cancelAnimation();
    return null;
  } else {
    return startTime;
  }
}
let startFrameTime;
let readyAnimation;
const suspendedAnimations = /* @__PURE__ */ new Set();
function resumeSuspendedAnimations() {
  suspendedAnimations.forEach((data) => {
    data.animation.play();
    data.animation.startTime = data.startTime;
  });
  suspendedAnimations.clear();
}
function startOptimizedAppearAnimation(element, name, keyframes, options, onReady) {
  if (window.MotionIsMounted) {
    return;
  }
  const id2 = element.dataset[optimizedAppearDataId];
  if (!id2)
    return;
  window.MotionHandoffAnimation = handoffOptimizedAppearAnimation;
  const storeId = appearStoreId(id2, name);
  if (!readyAnimation) {
    readyAnimation = startWaapiAnimation(
      element,
      name,
      [keyframes[0], keyframes[0]],
      /**
       * 10 secs is basically just a super-safe duration to give Chrome
       * long enough to get the animation ready.
       */
      { duration: 1e4, ease: "linear" }
    );
    appearAnimationStore.set(storeId, {
      animation: readyAnimation,
      startTime: null
    });
    window.MotionHandoffAnimation = handoffOptimizedAppearAnimation;
    window.MotionHasOptimisedAnimation = (elementId, valueName) => {
      if (!elementId)
        return false;
      if (!valueName) {
        return appearComplete.has(elementId);
      }
      const animationId = appearStoreId(elementId, valueName);
      return Boolean(appearAnimationStore.get(animationId));
    };
    window.MotionHandoffMarkAsComplete = (elementId) => {
      if (appearComplete.has(elementId)) {
        appearComplete.set(elementId, true);
      }
    };
    window.MotionHandoffIsComplete = (elementId) => {
      return appearComplete.get(elementId) === true;
    };
    window.MotionCancelOptimisedAnimation = (elementId, valueName, frame2, canResume) => {
      const animationId = appearStoreId(elementId, valueName);
      const data = appearAnimationStore.get(animationId);
      if (!data)
        return;
      if (frame2 && canResume === void 0) {
        frame2.postRender(() => {
          frame2.postRender(() => {
            data.animation.cancel();
          });
        });
      } else {
        data.animation.cancel();
      }
      if (frame2 && canResume) {
        suspendedAnimations.add(data);
        frame2.render(resumeSuspendedAnimations);
      } else {
        appearAnimationStore.delete(animationId);
        if (!appearAnimationStore.size) {
          window.MotionCancelOptimisedAnimation = void 0;
        }
      }
    };
    window.MotionCheckAppearSync = (visualElement, valueName, value) => {
      const appearId = getOptimisedAppearId(visualElement);
      if (!appearId)
        return;
      const valueIsOptimised = window.MotionHasOptimisedAnimation?.(appearId, valueName);
      const externalAnimationValue = visualElement.props.values?.[valueName];
      if (!valueIsOptimised || !externalAnimationValue)
        return;
      const removeSyncCheck = value.on("change", (latestValue) => {
        if (externalAnimationValue.get() !== latestValue) {
          window.MotionCancelOptimisedAnimation?.(appearId, valueName);
          removeSyncCheck();
        }
      });
      return removeSyncCheck;
    };
  }
  const startAnimation = () => {
    readyAnimation.cancel();
    const appearAnimation = startWaapiAnimation(element, name, keyframes, options);
    if (startFrameTime === void 0) {
      startFrameTime = performance.now();
    }
    appearAnimation.startTime = startFrameTime;
    appearAnimationStore.set(storeId, {
      animation: appearAnimation,
      startTime: startFrameTime
    });
    if (onReady)
      onReady(appearAnimation);
  };
  appearComplete.set(id2, false);
  if (readyAnimation.ready) {
    readyAnimation.ready.then(startAnimation).catch(noop);
  } else {
    startAnimation();
  }
}
const createObject = () => ({});
class StateVisualElement extends VisualElement {
  constructor() {
    super(...arguments);
    this.measureInstanceViewportBox = createBox;
  }
  build() {
  }
  resetTransform() {
  }
  restoreTransform() {
  }
  removeValueFromRenderState() {
  }
  renderInstance() {
  }
  scrapeMotionValuesFromProps() {
    return createObject();
  }
  getBaseTargetFromProps() {
    return void 0;
  }
  readValueFromInstance(_state, key, options) {
    return options.initialState[key] || 0;
  }
  sortInstanceNodePosition() {
    return 0;
  }
}
const useVisualState = makeUseVisualState({
  scrapeMotionValuesFromProps: createObject,
  createRenderState: createObject
});
function useAnimatedState(initialState) {
  const [animationState, setAnimationState] = reactExports.useState(initialState);
  const visualState = useVisualState({}, false);
  const element = useConstant(() => {
    return new StateVisualElement({
      props: {
        onUpdate: (v) => {
          setAnimationState({ ...v });
        }
      },
      visualState,
      presenceContext: null
    }, { initialState });
  });
  reactExports.useLayoutEffect(() => {
    element.mount({});
    return () => element.unmount();
  }, [element]);
  const startAnimation = useConstant(() => (animationDefinition) => {
    return animateVisualElement(element, animationDefinition);
  });
  return [animationState, startAnimation];
}
let id = 0;
const AnimateSharedLayout = ({ children }) => {
  reactExports.useEffect(() => {
  }, []);
  return jsxRuntimeExports.jsx(LayoutGroup, { id: useConstant(() => `asl-${id++}`), children });
};
const maxScale = 1e5;
const invertScale = (scale) => scale > 1e-3 ? 1 / scale : maxScale;
function useInvertedScale(scale) {
  let parentScaleX = useMotionValue(1);
  let parentScaleY = useMotionValue(1);
  const { visualElement } = reactExports.useContext(MotionContext);
  if (scale) {
    parentScaleX = scale.scaleX || parentScaleX;
    parentScaleY = scale.scaleY || parentScaleY;
  } else if (visualElement) {
    parentScaleX = visualElement.getValue("scaleX", 1);
    parentScaleY = visualElement.getValue("scaleY", 1);
  }
  const scaleX = useTransform(parentScaleX, invertScale);
  const scaleY = useTransform(parentScaleY, invertScale);
  return { scaleX, scaleY };
}
const ReorderContext = reactExports.createContext(null);
function checkReorder(order, value, offset, velocity) {
  if (!velocity)
    return order;
  const index = order.findIndex((item2) => item2.value === value);
  if (index === -1)
    return order;
  const nextOffset = velocity > 0 ? 1 : -1;
  const nextItem = order[index + nextOffset];
  if (!nextItem)
    return order;
  const item = order[index];
  const nextLayout = nextItem.layout;
  const nextItemCenter = mixNumber(nextLayout.min, nextLayout.max, 0.5);
  if (nextOffset === 1 && item.layout.max + offset > nextItemCenter || nextOffset === -1 && item.layout.min + offset < nextItemCenter) {
    return moveItem(order, index, index + nextOffset);
  }
  return order;
}
function ReorderGroupComponent({ children, as: as2 = "ul", axis = "y", onReorder, values, ...props }, externalRef) {
  const Component = useConstant(() => motion[as2]);
  const order = [];
  const isReordering = reactExports.useRef(false);
  const context = {
    axis,
    registerItem: (value, layout2) => {
      const idx = order.findIndex((entry) => value === entry.value);
      if (idx !== -1) {
        order[idx].layout = layout2[axis];
      } else {
        order.push({ value, layout: layout2[axis] });
      }
      order.sort(compareMin);
    },
    updateOrder: (item, offset, velocity) => {
      if (isReordering.current)
        return;
      const newOrder = checkReorder(order, item, offset, velocity);
      if (order !== newOrder) {
        isReordering.current = true;
        onReorder(newOrder.map(getValue).filter((value) => values.indexOf(value) !== -1));
      }
    }
  };
  reactExports.useEffect(() => {
    isReordering.current = false;
  });
  return jsxRuntimeExports.jsx(Component, { ...props, ref: externalRef, ignoreStrict: true, children: jsxRuntimeExports.jsx(ReorderContext.Provider, { value: context, children }) });
}
const ReorderGroup = /* @__PURE__ */ reactExports.forwardRef(ReorderGroupComponent);
function getValue(item) {
  return item.value;
}
function compareMin(a, b) {
  return a.layout.min - b.layout.min;
}
function useDefaultMotionValue(value, defaultValue = 0) {
  return isMotionValue(value) ? value : useMotionValue(defaultValue);
}
function ReorderItemComponent({ children, style: style2 = {}, value, as: as2 = "li", onDrag, layout: layout2 = true, ...props }, externalRef) {
  const Component = useConstant(() => motion[as2]);
  const context = reactExports.useContext(ReorderContext);
  const point2 = {
    x: useDefaultMotionValue(style2.x),
    y: useDefaultMotionValue(style2.y)
  };
  const zIndex = useTransform([point2.x, point2.y], ([latestX, latestY]) => latestX || latestY ? 1 : "unset");
  const { axis, registerItem, updateOrder } = context;
  return jsxRuntimeExports.jsx(Component, { drag: axis, ...props, dragSnapToOrigin: true, style: { ...style2, x: point2.x, y: point2.y, zIndex }, layout: layout2, onDrag: (event, gesturePoint) => {
    const { velocity } = gesturePoint;
    velocity[axis] && updateOrder(value, point2[axis].get(), velocity[axis]);
    onDrag && onDrag(event, gesturePoint);
  }, onLayoutMeasure: (measured) => registerItem(value, measured), ref: externalRef, ignoreStrict: true, children });
}
const ReorderItem = /* @__PURE__ */ reactExports.forwardRef(ReorderItemComponent);
const namespace = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  Group: ReorderGroup,
  Item: ReorderItem
}, Symbol.toStringTag, { value: "Module" }));
export {
  as as AnimatePresence,
  AnimateSharedLayout,
  at as AsyncMotionValueAnimation,
  au as DOMKeyframesResolver,
  DeprecatedLayoutGroupContext,
  DragControls,
  GroupAnimation,
  GroupAnimationWithThen,
  JSAnimation,
  av as KeyframeResolver,
  LayoutGroup,
  LayoutGroupContext,
  aw as LazyMotion,
  ax as MotionConfig,
  MotionConfigContext,
  MotionContext,
  MotionGlobalConfig,
  MotionValue,
  NativeAnimation,
  ay as NativeAnimationExtended,
  NativeAnimationWrapper,
  az as PopChild,
  aA as PresenceChild,
  PresenceContext,
  namespace as Reorder,
  aB as SubscriptionManager,
  aC as SwitchLayoutGroupContext,
  ViewTransitionBuilder,
  VisualElement,
  WillChangeMotionValue,
  acceleratedValues,
  activeAnimations,
  addAttrValue,
  aD as addPointerEvent,
  aE as addPointerInfo,
  aF as addScaleCorrector,
  addStyleValue,
  aG as addUniqueItem,
  aH as alpha,
  aI as analyseComplexValue,
  animate,
  animateMini,
  aJ as animateValue,
  animateView,
  animateVisualElement,
  animationControls,
  animationMapKey,
  animations,
  aK as anticipate,
  applyGeneratorOptions,
  applyPxDefaults,
  attachSpring,
  attrEffect,
  aL as backIn,
  aM as backInOut,
  aN as backOut,
  aO as buildTransform,
  aP as calcGeneratorDuration,
  aQ as calcLength,
  cancelFrame,
  aR as cancelMicrotask,
  cancelSync,
  aS as circIn,
  aT as circInOut,
  aU as circOut,
  clamp,
  collectMotionValues,
  aV as color,
  aW as complex,
  aX as convertOffsetToTimes,
  createBox,
  createGeneratorEasing,
  aY as createRenderBatcher,
  createScopedAnimate,
  aZ as cubicBezier,
  a_ as cubicBezierAsString,
  a$ as defaultEasing,
  defaultOffset$1 as defaultOffset,
  b0 as defaultTransformValue,
  b1 as defaultValueTypes,
  b2 as degrees,
  b3 as delay,
  b4 as dimensionValueTypes,
  disableInstantTransitions,
  b5 as distance,
  b6 as distance2D,
  domAnimation,
  domMax,
  domMin,
  b7 as easeIn,
  b8 as easeInOut,
  b9 as easeOut,
  easingDefinitionToFunction,
  fillOffset,
  fillWildcards,
  ba as filterProps,
  bb as findDimensionValueType,
  bc as findValueType,
  bd as flushKeyframeResolvers,
  frame,
  frameData,
  be as frameSteps,
  bf as generateLinearEasing,
  bg as getAnimatableNone,
  getAnimationMap,
  getComputedStyle$1 as getComputedStyle,
  bh as getDefaultValueType,
  getEasingForSegment,
  bi as getMixer,
  getOriginIndex,
  getValueAsType,
  getValueTransition$1 as getValueTransition,
  bj as getVariableValue,
  getViewAnimationLayerInfo,
  getViewAnimations,
  hasWarned,
  bk as hex,
  bl as hover,
  bm as hsla,
  bn as hslaToRgba,
  inView,
  bo as inertia,
  interpolate,
  invariant,
  bp as invisibleValues,
  isBezierDefinition,
  bq as isBrowser,
  br as isCSSVariableName,
  bs as isCSSVariableToken,
  bt as isDragActive,
  bu as isDragging,
  isEasingArray,
  isGenerator,
  isHTMLElement,
  isMotionComponent,
  isMotionValue,
  bv as isNodeOrChild,
  bw as isNumericalString,
  bx as isObject,
  by as isPrimaryPointer,
  isSVGElement,
  isSVGSVGElement,
  bz as isValidMotionProp,
  isWaapiSupportedEasing,
  bA as isZeroValueString,
  bB as keyframes,
  bC as m,
  bD as makeAnimationInstant,
  makeUseVisualState,
  mapEasingToNativeEasing,
  mapValue,
  bE as maxGeneratorDuration,
  memo,
  microtask,
  bF as millisecondsToSeconds,
  bG as mirrorEasing,
  bH as mix,
  bI as mixArray,
  bJ as mixColor,
  bK as mixComplex,
  bL as mixImmediate,
  bM as mixLinearColor,
  mixNumber,
  bN as mixObject,
  bO as mixVisibility,
  motion,
  motionValue,
  moveItem,
  noop,
  bP as number,
  numberValueTypes,
  observeTimeline,
  bQ as optimizedAppearDataAttribute,
  bR as parseCSSVariable,
  bS as parseValueFromTransform,
  bT as percent,
  bU as pipe,
  bV as positionalKeys,
  bW as press,
  progress,
  bX as progressPercentage,
  propEffect,
  px,
  bY as readTransformValue,
  recordStats,
  removeItem,
  resize,
  resolveElements,
  bZ as resolveMotionValue,
  b_ as reverseEasing,
  b$ as rgbUnit,
  c0 as rgba,
  c1 as scale,
  scroll,
  scrollInfo,
  secondsToMilliseconds,
  c2 as setDragLock,
  c3 as setStyle,
  spring,
  springValue,
  stagger,
  startOptimizedAppearAnimation,
  startWaapiAnimation,
  statsBuffer,
  steps,
  styleEffect,
  supportedWaapiEasing,
  c4 as supportsBrowserAnimation,
  c5 as supportsFlags,
  supportsLinearEasing,
  supportsPartialKeyframes,
  supportsScrollTimeline,
  svgEffect,
  sync,
  c6 as testValueType,
  c7 as time,
  transform,
  transformPropOrder,
  transformProps,
  transformValue,
  c8 as transformValueTypes,
  unwrapMotionComponent,
  useAnimate,
  useAnimateMini,
  useAnimation,
  useAnimationControls,
  useAnimationFrame,
  c9 as useComposedRefs,
  useCycle,
  useAnimatedState as useDeprecatedAnimatedState,
  useInvertedScale as useDeprecatedInvertedScale,
  useDomEvent,
  useDragControls,
  useElementScroll,
  useForceUpdate,
  useInView,
  useInstantLayoutTransition,
  useInstantTransition,
  ca as useIsPresent,
  useIsomorphicLayoutEffect,
  useMotionTemplate,
  useMotionValue,
  useMotionValueEvent,
  usePageInView,
  cb as usePresence,
  usePresenceData,
  useReducedMotion,
  useReducedMotionConfig,
  useResetProjection,
  useScroll,
  useSpring,
  useTime,
  useTransform,
  useUnmountEffect,
  useVelocity,
  useViewportScroll,
  useWillChange,
  velocityPerSecond,
  cc as vh,
  visualElementStore,
  cd as vw,
  warnOnce,
  ce as warning,
  wrap
};
