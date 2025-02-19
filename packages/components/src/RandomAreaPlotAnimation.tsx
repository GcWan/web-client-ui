/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable react/display-name */

import React, { useEffect, useState, useRef } from 'react';
import debounce from 'lodash.debounce';
import { assertNotNull } from '@deephaven/utils';
import './RandomAreaPlotAnimation.scss';
import { resolveCssVariablesInRecord, useTheme } from './theme';

const VOLATILITY = 0.025; // how spikey the data gets
const LOW = 0.9;
const HIGH = 0.1;
const START_Y = 0.618;
const GRID_SIZE = 80;
const PATTERN = { SIZE: 8, DOT_SIZE: 2 };
const PX_PER_SECOND = 18;
const RESIZE_DEBOUNCE = 250;
const INTERACTION_TIMEOUT = 60 * 1000;

interface ThemeColors {
  background: string;
  foregroundFill: string;
  foregroundStroke: string;
  gridColor: string;
}

const THEME_COLOR_VARIABLES = {
  background: 'var(--dh-color-random-area-plot-animation-bg)',
  foregroundFill: 'var(--dh-color-random-area-plot-animation-fg-fill)',
  foregroundStroke: 'var(--dh-color-random-area-plot-animation-fg-stroke)',
  gridColor: 'var(--dh-color-random-area-plot-animation-grid)',
} satisfies ThemeColors;

/**
 * Resolve theme colors needed for our animation.
 */
function getRandomAreaPlotAnimationThemeColors(): ThemeColors {
  return resolveCssVariablesInRecord(THEME_COLOR_VARIABLES);
}

// Draw a background canvas, paint it with a fun chart looking animation
const RandomAreaPlotAnimation = React.memo(() => {
  const { activeThemes } = useTheme();

  const [themeColors, setThemeColors] = useState<ThemeColors | null>(null);

  // Resolving css variables has to run in `useEffect` or `useLayoutEffect` so
  // that we know React has updated the DOM with any styles set by the
  // ThemeProvider.
  useEffect(() => {
    setThemeColors(getRandomAreaPlotAnimationThemeColors());
  }, [activeThemes]);

  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [shade, setShade] = useState(false);
  const scale = window.devicePixelRatio;

  let ctx: CanvasRenderingContext2D | null | undefined;
  let pattern: CanvasPattern | null | undefined;
  let width: number;
  let height: number;
  let rAF: number | null;

  let lastTimestamp: DOMHighResTimeStamp | null | undefined = null;
  let data: number[] = [];

  function setCanvasSize(): void {
    // Set canvas size to fill screen
    if (container.current != null) {
      width = container.current.offsetWidth;
      height = container.current.offsetHeight;
    }

    if (canvas.current != null) {
      canvas.current.style.width = `${width}px`;
      canvas.current.style.height = `${height}px`;

      canvas.current.width = width * scale;
      canvas.current.height = height * scale;
    }

    ctx?.scale(scale, scale);
  }

  // Returns the background fill create offscreen as pattern
  function createPatternFill(): CanvasPattern | null | undefined {
    if (themeColors == null) {
      return null;
    }

    const { foregroundFill, foregroundStroke } = themeColors;

    // create the off-screen canvas
    const canvasPattern = document.createElement('canvas');
    canvasPattern.width = PATTERN.SIZE;
    canvasPattern.height = PATTERN.SIZE;
    const contextPattern = canvasPattern.getContext('2d');

    // draw pattern to off-screen context
    if (contextPattern != null) {
      contextPattern.fillStyle = foregroundStroke;
      contextPattern.fillRect(0, 0, PATTERN.DOT_SIZE, PATTERN.DOT_SIZE);

      // add an overlay fill
      contextPattern.fillStyle = foregroundFill;
      contextPattern.fillRect(0, 0, PATTERN.SIZE, PATTERN.SIZE);
    }
    return contextPattern?.createPattern(canvasPattern, 'repeat');
  }

  /**
   * Generates a step in a random walk between LOW - HIGH given a previous value
   * data is always in 0-1 data space so its scaleable
   * data space is converted to screen space inside draw functions
   * @param prev previous random walk step
   * @return new random walk step
   */
  function randomWalk(prev: number): number {
    const rand = Math.random() - 0.5; // give it directionality
    let change = VOLATILITY * rand; // scale by volatity constant

    // ensure directional bounce off approaching edges
    if (prev < HIGH) {
      change = Math.abs(change);
    } else if (prev > LOW) {
      change = -Math.abs(change);
    }

    return prev + change;
  }

  function initData(): number[] {
    const startingData = [];
    let y = START_Y; // always start towards the bottom of the screen
    for (let x = 0; x < width + PX_PER_SECOND; x += 1) {
      y = randomWalk(y);
      startingData.push(y);
    }
    return startingData;
  }

  function setDataSize(): void {
    while (data.length >= width + PX_PER_SECOND) {
      data.pop();
    }
    while (data.length < width + PX_PER_SECOND) {
      data.push(randomWalk(data[data.length - 1]));
    }
  }

  function drawAreaLine(
    path: number[],
    context: CanvasRenderingContext2D
  ): void {
    context.beginPath();
    // start offscreen
    context.moveTo(-1, height + 1);
    context.lineTo(-1, height * path[0]);

    // draw the line
    for (let i = 0; i < path.length; i += 1) {
      context.lineTo(i, height * path[i]);
    }

    // close offscreen
    context.lineTo(width + PX_PER_SECOND, height * path[path.length - 1]);
    context.lineTo(width + PX_PER_SECOND, height + 1);
    context.closePath();
  }

  function drawGridLines(context: CanvasRenderingContext2D): void {
    context.beginPath();
    // draw verticals
    for (let x = 1; x < width; x += GRID_SIZE) {
      context.moveTo(x, 0);
      context.lineTo(x, height);
    }
    // draw horizontals
    for (let y = 1; y < height; y += GRID_SIZE) {
      context.moveTo(0, y);
      context.lineTo(width, y);
    }
  }

  /**
   * Main draw loop for where the animation happens
   * all the styling happens within drawCanvas from paths generated by other functions
   * @param timestamp passed in callback from requestAnimationFrame
   */
  function drawCanvas(timestamp?: DOMHighResTimeStamp): void {
    if (themeColors == null) {
      return;
    }

    lastTimestamp = lastTimestamp ?? timestamp;

    const { background, foregroundStroke, gridColor } = themeColors;

    assertNotNull(ctx);
    // clear the canvas
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    drawGridLines(ctx);
    ctx.lineWidth = 1;
    ctx.strokeStyle = gridColor;
    ctx.stroke();

    // for speeds less then 60 px per second, subpixel motion is required to look smooth
    const subPixelMotion =
      ((lastTimestamp ?? 0) - (timestamp ?? 0)) / (1000 / PX_PER_SECOND);
    ctx.translate(subPixelMotion, 0);

    drawAreaLine(data, ctx);
    ctx.lineWidth = 2;
    ctx.strokeStyle = foregroundStroke;
    ctx.stroke();

    ctx.translate(-subPixelMotion, 0); // we don't pattern to shift however
    if (pattern != null) {
      ctx.fillStyle = pattern;
    }
    ctx.fill();
    ctx.setTransform(scale, 0, 0, scale, 0, 0); // reset the translate matrix to normal

    // generate new data points
    if ((timestamp ?? 0) - (lastTimestamp ?? 0) > 1000 / PX_PER_SECOND) {
      // number of points to add since last update
      const numberOfPoints = Math.floor(
        ((timestamp ?? 0) - (lastTimestamp ?? 0)) / (1000 / PX_PER_SECOND)
      );
      for (let i = 0; i < numberOfPoints; i += 1) {
        data.shift();
        data.push(randomWalk(data[data.length - 1]));
      }
      lastTimestamp = timestamp;
    }

    if (rAF != null) {
      cancelAnimationFrame(rAF);
    }
    rAF = requestAnimationFrame(drawCanvas);
  }

  // debounce the resize so its not overly aggresive
  const debouncedHandleResize = debounce(
    () => {
      rAF = requestAnimationFrame(timestamp => {
        setCanvasSize(); // setCanvas can cause lag if not debounced

        // fill or remove extra data points
        setDataSize();

        // opening devtools triggers a blur then resize,
        // need to reset shade as we are restarting animation
        setShade(false);
        drawCanvas(timestamp);
      });
    },
    RESIZE_DEBOUNCE,
    { leading: true } // resize immediately, once.
  );

  function pauseAnimation(): void {
    // pause animation when browser window is blurred to conserve CPU usage
    setShade(true);
    if (rAF != null) {
      cancelAnimationFrame(rAF);
    }
    rAF = null;
    lastTimestamp = null;
  }

  // when timeout expires, pause animation
  const resetIdleTimeout = debounce(() => {
    pauseAnimation();
  }, INTERACTION_TIMEOUT);

  function startAnimation(): void {
    // can fire multiple times, check if rAF is null first
    // restart animation loop, and fade back in
    if (rAF == null) {
      setShade(false);
      setCanvasSize();
      setDataSize();
      rAF = requestAnimationFrame(drawCanvas);
    }
    resetIdleTimeout();
  }

  function handleActivity(): void {
    if (document.hasFocus()) {
      // only if document has focus (mousemove can fire on non-focused tabs)
      startAnimation();
    }
  }

  function handleResize(): void {
    // pause and debounce animation during resize for better resizing performance
    if (rAF != null) {
      cancelAnimationFrame(rAF);
    }
    resetIdleTimeout(); // treat resizing as a form of activity
    debouncedHandleResize();
  }

  // react mount/unmount hooks
  useEffect(() => {
    ctx = canvas.current?.getContext('2d', { alpha: false });
    setCanvasSize();
    data = initData();
    pattern = createPatternFill();

    // start draw loop
    drawCanvas();
    resetIdleTimeout();

    window.addEventListener('resize', handleResize);

    window.addEventListener('focus', startAnimation);
    window.addEventListener('blur', pauseAnimation);

    // don't burn cpu if the user is "idle", start a timer that resets
    // on any user activity, and on timeout expiry pause the animation
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);

    return () => {
      if (rAF != null) {
        cancelAnimationFrame(rAF);
      }
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('focus', startAnimation);
      window.removeEventListener('blur', pauseAnimation);

      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);

      resetIdleTimeout.cancel();
      debouncedHandleResize.cancel();
    };
  }, [themeColors]);

  return (
    themeColors && (
      <div className="random-area-plot-animation-container" ref={container}>
        <canvas ref={canvas} className={shade ? 'shade' : ''} />
      </div>
    )
  );
});

export default RandomAreaPlotAnimation;
