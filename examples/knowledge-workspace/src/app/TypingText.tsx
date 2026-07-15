// src/components/fortemi/TypingText.tsx
//
// Self-managed faux-typing for values that the enrichment pipeline fills in
// (a note's AI-generated title, etc.) — so a change reads as the agent *writing*
// into the data alongside you, not a hard pop. Ported from the HotM project's
// TypingAnimation: a Perlin-like 1D value-noise drives a human/agent cadence
// (jittered keystroke timing, the odd pause, a rare typo + correction), with a
// backspace-then-retype from the previous value to the new one.
//
// Unlike HotM's controlled (oldText/newText) component, this one is self-managed:
// pass `text`; it animates from whatever it last showed to the new value whenever
// `text` changes. First render shows `text` immediately (no animation).

import { useEffect, useRef, useState, type CSSProperties } from 'react';

type Speed = 'slow' | 'normal' | 'fast';
type TypingEvent = { type: 'delete' | 'type' | 'pause'; char?: string; duration: number };

const SPEEDS: Record<Speed, { type: number; delete: number; pause: number; mistake: number }> = {
  slow: { type: 145, delete: 92, pause: 330, mistake: 240 },
  normal: { type: 80, delete: 50, pause: 200, mistake: 170 },
  fast: { type: 52, delete: 34, pause: 120, mistake: 110 },
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const smoothstep = (t: number) => t * t * (3 - 2 * t);

function seededHash(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function baseNoise(x: number, seed: number): number {
  const n = Math.sin(x * 12.9898 + seed * 0.0001) * 43758.5453;
  return n - Math.floor(n);
}
// Perlin-like 1D value noise in [0, 1].
function perlin1d(x: number, seed: number): number {
  const x0 = Math.floor(x);
  const t = x - x0;
  const n0 = baseNoise(x0, seed);
  const n1 = baseNoise(x0 + 1, seed);
  return n0 + (n1 - n0) * smoothstep(t);
}

function buildEvents(from: string, to: string, speed: Speed): TypingEvent[] {
  const events: TypingEvent[] = [];
  if (from === to) return events;
  const cfg = SPEEDS[speed];
  const seed = seededHash(`${from}=>${to}`);
  let cur = 0;
  const noiseAt = (step: number, freq = 0.55) => perlin1d(step * freq, seed);
  const jitter = (base: number, step: number, spread = 0.75) =>
    Math.round(base * (1 + (noiseAt(step) * 2 - 1) * spread));

  // brief "thinking" pause
  events.push({ type: 'pause', duration: clamp(jitter(cfg.pause, cur++, 0.7), 55, cfg.pause * 2.4) });

  // backspace the old value
  for (let i = from.length; i > 0; i -= 1) {
    if (noiseAt(cur, 0.35) > 0.9) {
      events.push({ type: 'pause', duration: clamp(jitter(cfg.pause * 0.75, cur++, 0.8), 40, cfg.pause * 2.1) });
    }
    events.push({ type: 'delete', duration: clamp(jitter(cfg.delete, cur++, 0.9), 18, cfg.delete * 2.4) });
  }
  if (from.length > 0) {
    events.push({ type: 'pause', duration: clamp(jitter(cfg.pause, cur++, 0.75), 65, cfg.pause * 2.5) });
  }

  // type the new value with variable cadence + at most one typo+correction
  const alpha = 'abcdefghijklmnopqrstuvwxyz';
  let typoDone = false;
  for (let i = 0; i < to.length; i += 1) {
    const char = to[i];
    const shouldTypo =
      !typoDone && char.trim().length > 0 && i < to.length - 1 && noiseAt(cur + i * 0.9, 0.42) > 0.993;
    if (shouldTypo) {
      typoDone = true;
      const len = clamp(2 + Math.floor(noiseAt(cur + i * 1.3, 0.31) * 4), 2, 5);
      for (let t = 0; t < len; t += 1) {
        const wrong = alpha[Math.floor(noiseAt(cur + t + i * 1.3, 0.73) * alpha.length)] || 'x';
        events.push({ type: 'type', char: wrong, duration: clamp(jitter(cfg.type, cur++, 0.95), 20, cfg.type * 2.6) });
      }
      events.push({ type: 'pause', duration: clamp(jitter(cfg.mistake, cur++, 0.9), 55, cfg.mistake * 2.4) });
      for (let t = 0; t < len; t += 1) {
        events.push({ type: 'delete', duration: clamp(jitter(cfg.delete, cur++, 0.95), 18, cfg.delete * 2.6) });
      }
      events.push({ type: 'pause', duration: clamp(jitter(cfg.mistake * 0.55, cur++, 0.8), 35, cfg.mistake * 1.8) });
    }
    events.push({ type: 'type', char, duration: clamp(jitter(cfg.type, cur++, 0.95), 20, cfg.type * 2.7) });
    if (['.', '!', '?', ',', ';', ':'].includes(char)) {
      events.push({ type: 'pause', duration: clamp(jitter(cfg.pause * 0.65, cur++, 0.8), 40, cfg.pause * 1.9) });
    }
  }
  return events;
}

export function TypingText({
  text,
  speed = 'normal',
  style,
  cursorColor = 'var(--color-lit-accent-live)',
}: {
  text: string;
  speed?: Speed;
  style?: CSSProperties;
  cursorColor?: string;
}) {
  const [displayed, setDisplayed] = useState(text);
  const [animating, setAnimating] = useState(false);
  const shownRef = useRef(text); // what's currently on screen (source of the next transition)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (text === shownRef.current) return;
    const events = buildEvents(shownRef.current, text, speed);
    shownRef.current = text;
    if (events.length === 0) {
      setDisplayed(text);
      return;
    }
    let i = 0;
    setAnimating(true);
    const step = () => {
      if (i >= events.length) {
        setAnimating(false);
        setDisplayed(text); // settle exactly on the target
        return;
      }
      const ev = events[i++];
      if (ev.type === 'delete') setDisplayed((p) => p.slice(0, -1));
      else if (ev.type === 'type' && ev.char) setDisplayed((p) => p + ev.char);
      timer.current = setTimeout(step, ev.duration);
    };
    step();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [text, speed]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <span style={style}>
      {displayed}
      {animating && (
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: '0.5ch',
            marginLeft: '0.1ch',
            background: cursorColor,
            // a tall thin caret that blinks; line-height keeps it inline-aligned
            height: '1em',
            verticalAlign: '-0.12em',
            animation: 'fortemiCaret 1s steps(2, start) infinite',
          }}
        />
      )}
    </span>
  );
}

export default TypingText;
