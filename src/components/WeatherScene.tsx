'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef } from 'react';
import type { Condition } from '@/lib/types';

export type Phase = 'night' | 'dawn' | 'day' | 'dusk';

interface Props {
  condition: Condition | null;
  phase: Phase;
  /** 0–100 */
  cloudCover?: number | null;
  windKmh?: number | null;
  animation: 'full' | 'reduced' | 'off';
  className?: string;
}

/** Work out day/night/dawn/dusk from sunrise and sunset. */
export function phaseFor(now: number, sunrise: string | null | undefined, sunset: string | null | undefined, isDay: boolean | null | undefined): Phase {
  const sr = sunrise ? Date.parse(sunrise) : NaN;
  const ss = sunset ? Date.parse(sunset) : NaN;
  if (Number.isFinite(sr) && Number.isFinite(ss)) {
    const w = 45 * 60_000;
    if (Math.abs(now - sr) < w) return 'dawn';
    if (Math.abs(now - ss) < w) return 'dusk';
    return now > sr && now < ss ? 'day' : 'night';
  }
  if (isDay === false) return 'night';
  return 'day';
}

const SKY: Record<Phase, { clear: string[]; overcast: string[]; storm: string[] }> = {
  day: { clear: ['#1e6fd9', '#4a9cf0', '#9ccdf8'], overcast: ['#5d7088', '#8597ab', '#b6c2cf'], storm: ['#2b3442', '#465263', '#6a7686'] },
  night: { clear: ['#020617', '#0b1638', '#1e2a5a'], overcast: ['#0b0f19', '#1a2130', '#2a3242'], storm: ['#05070c', '#121722', '#1f2633'] },
  dawn: { clear: ['#2d3a7a', '#c86b8a', '#fbb47a'], overcast: ['#4a4d66', '#8a7a86', '#c7a38e'], storm: ['#2a2d3a', '#4c4a55', '#6f6670'] },
  dusk: { clear: ['#1b2154', '#a8456b', '#f59a5b'], overcast: ['#3b3a52', '#7a6474', '#b78a7c'], storm: ['#20212c', '#423d48', '#625962'] },
};

function skyFor(phase: Phase, condition: Condition | null, cloud: number) {
  const s = SKY[phase];
  if (condition === 'thunderstorm' || condition === 'heavy-rain') return s.storm;
  if (condition === 'rain' || condition === 'drizzle' || condition === 'sleet' || condition === 'snow' || condition === 'fog' || condition === 'cloudy' || cloud > 80) return s.overcast;
  return s.clear;
}

type Precip = 'none' | 'drizzle' | 'rain' | 'heavy' | 'snow' | 'sleet';

function precipFor(c: Condition | null): Precip {
  switch (c) {
    case 'drizzle':
      return 'drizzle';
    case 'rain':
      return 'rain';
    case 'heavy-rain':
    case 'thunderstorm':
      return 'heavy';
    case 'snow':
      return 'snow';
    case 'sleet':
      return 'sleet';
    default:
      return 'none';
  }
}

/** Canvas particle layer for rain, snow and sleet. */
function PrecipCanvas({ kind, wind, reduced }: { kind: Precip; wind: number; reduced: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || kind === 'none') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    const density = { none: 0, drizzle: 0.08, rain: 0.18, heavy: 0.35, snow: 0.1, sleet: 0.14 }[kind];
    const count = Math.round(w * density * (reduced ? 0.4 : 1));
    const slant = Math.max(-0.6, Math.min(0.6, wind / 60));
    type P = { x: number; y: number; v: number; len: number; snow: boolean; phase: number; r: number };
    const make = (initial: boolean): P => {
      const snow = kind === 'snow' || (kind === 'sleet' && Math.random() < 0.5);
      return {
        x: Math.random() * (w + 200) - 100,
        y: initial ? Math.random() * h : -20,
        v: snow ? 0.6 + Math.random() * 0.9 : (kind === 'drizzle' ? 6 : 10) + Math.random() * 6,
        len: kind === 'drizzle' ? 6 + Math.random() * 4 : 10 + Math.random() * 14,
        snow,
        phase: Math.random() * Math.PI * 2,
        r: 1.2 + Math.random() * 2.4,
      };
    };
    const ps = Array.from({ length: count }, () => make(true));
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(3, (now - last) / 16.7);
      last = now;
      ctx.clearRect(0, 0, w, h);
      for (const p of ps) {
        if (p.snow) {
          p.phase += 0.02 * dt;
          p.y += p.v * dt;
          p.x += (Math.sin(p.phase) * 0.6 + slant * 2) * dt;
          ctx.beginPath();
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        } else {
          p.y += p.v * dt;
          p.x += p.v * slant * dt;
          ctx.beginPath();
          ctx.strokeStyle = kind === 'heavy' ? 'rgba(200,220,255,0.55)' : 'rgba(210,225,255,0.45)';
          ctx.lineWidth = kind === 'heavy' ? 1.4 : 1;
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.len * slant, p.y - p.len);
          ctx.stroke();
        }
        if (p.y > h + 20 || p.x > w + 120 || p.x < -120) Object.assign(p, make(false));
      }
      raf = requestAnimationFrame(tick);
    };
    if (reduced) {
      tick(performance.now());
      cancelAnimationFrame(raf);
    } else raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [kind, wind, reduced]);
  if (kind === 'none') return null;
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}

function CloudShape({ opacity, dark }: { opacity: number; dark: boolean }) {
  return (
    <svg viewBox="0 0 220 90" className="h-full w-full" aria-hidden>
      <defs>
        <radialGradient id={dark ? 'scd' : 'scl'} cx="50%" cy="35%" r="70%">
          <stop offset="0%" stopColor={dark ? '#94a3b8' : '#ffffff'} stopOpacity={opacity} />
          <stop offset="100%" stopColor={dark ? '#475569' : '#e2e8f0'} stopOpacity={opacity * 0.85} />
        </radialGradient>
      </defs>
      <path
        d="M30 78 C8 78 4 52 26 48 C22 26 52 16 66 32 C74 8 118 4 128 30 C140 16 172 20 174 44 C204 42 214 74 188 78 Z"
        fill={`url(#${dark ? 'scd' : 'scl'})`}
      />
    </svg>
  );
}

/**
 * The animated sky behind the homepage hero. Layers: gradient sky (cross-fades
 * between states), stars/sun/moon, drifting clouds, fog, precipitation and lightning.
 */
export function WeatherScene({ condition, phase, cloudCover, windKmh, animation, className }: Props) {
  const cloud = cloudCover ?? (condition === 'clear' ? 5 : condition === 'partly-cloudy' ? 45 : condition ? 90 : 30);
  const colors = skyFor(phase, condition, cloud);
  const precip = precipFor(condition);
  const reduced = animation !== 'full';
  const off = animation === 'off';
  const night = phase === 'night';
  const darkClouds = condition === 'thunderstorm' || condition === 'heavy-rain' || night;
  const showSun = (phase === 'day' || phase === 'dawn' || phase === 'dusk') && cloud < 85 && condition !== 'fog';
  const showMoon = night && cloud < 85;
  const nClouds = Math.round((cloud / 100) * 7);
  const windSpeed = Math.max(5, windKmh ?? 10);

  const clouds = useMemo(
    () =>
      Array.from({ length: nClouds }, (_, i) => ({
        top: 4 + ((i * 37) % 45),
        width: 180 + ((i * 53) % 160),
        delay: -((i * 17) % 60),
        duration: Math.max(40, 260 - windSpeed * 3) * (0.8 + ((i * 7) % 5) / 10),
        opacity: 0.55 + ((i * 13) % 40) / 100,
        startX: (i * 23) % 100,
      })),
    [nClouds, windSpeed],
  );
  const stars = useMemo(() => Array.from({ length: 70 }, (_, i) => ({ x: (i * 73) % 100, y: (i * 37) % 60, s: 1 + ((i * 7) % 3) * 0.5, d: (i % 7) * 0.6 })), []);
  const sunPos = phase === 'dawn' ? { left: '14%', top: '58%' } : phase === 'dusk' ? { left: '80%', top: '58%' } : { left: '78%', top: '12%' };

  return (
    <div className={`absolute inset-0 overflow-hidden ${className ?? ''}`} aria-hidden>
      <AnimatePresence initial={false}>
        <motion.div
          key={colors.join()}
          className="absolute inset-0"
          style={{ background: `linear-gradient(180deg, ${colors[0]} 0%, ${colors[1]} 55%, ${colors[2]} 100%)` }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: off ? 0 : 1.6, ease: 'easeInOut' }}
        />
      </AnimatePresence>

      {night && cloud < 70 && (
        <div className="absolute inset-0">
          {stars.map((s, i) => (
            <span
              key={i}
              className="motion-safe-only absolute rounded-full bg-white"
              style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, opacity: 0.7, animation: reduced ? undefined : `twinkle ${3 + s.d}s ${s.d}s ease-in-out infinite` }}
            />
          ))}
        </div>
      )}

      <AnimatePresence>
        {showSun && (
          <motion.div
            key={`sun-${phase}`}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={sunPos}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: cloud > 60 ? 0.45 : 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: off ? 0 : 1.4 }}
          >
            <div className="relative h-28 w-28 sm:h-36 sm:w-36">
              <div className={`absolute inset-[-60%] rounded-full blur-2xl ${phase === 'day' ? 'bg-amber-200/50' : 'bg-orange-300/60'}`} />
              <motion.div
                className={`absolute inset-0 rounded-full ${phase === 'day' ? 'bg-gradient-to-br from-yellow-100 via-amber-200 to-amber-400' : 'bg-gradient-to-br from-amber-200 via-orange-300 to-rose-400'}`}
                animate={reduced ? undefined : { scale: [1, 1.04, 1] }}
                transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
              />
            </div>
          </motion.div>
        )}
        {showMoon && (
          <motion.div key="moon" className="absolute left-[78%] top-[14%]" initial={{ opacity: 0 }} animate={{ opacity: 0.95 }} exit={{ opacity: 0 }} transition={{ duration: off ? 0 : 1.4 }}>
            <div className="relative h-20 w-20 sm:h-24 sm:w-24">
              <div className="absolute inset-[-50%] rounded-full bg-slate-200/10 blur-2xl" />
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-slate-50 to-slate-300 shadow-[inset_-10px_-6px_0_rgba(100,116,139,0.35)]" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute inset-0">
        {clouds.map((c, i) => (
          <div
            key={i}
            className="motion-safe-only absolute"
            style={{
              top: `${c.top}%`,
              left: reduced ? `${c.startX - 10}%` : 0,
              width: c.width,
              height: c.width * 0.42,
              animation: reduced ? undefined : `drift ${c.duration}s ${c.delay}s linear infinite`,
            }}
          >
            <CloudShape opacity={c.opacity} dark={darkClouds} />
          </div>
        ))}
      </div>

      {condition === 'fog' && (
        <div className="absolute inset-0">
          {[30, 50, 70].map((top, i) => (
            <motion.div
              key={top}
              className="absolute left-[-20%] h-24 w-[140%] rounded-full bg-white/25 blur-2xl"
              style={{ top: `${top}%` }}
              animate={reduced ? undefined : { x: ['-4%', '4%', '-4%'] }}
              transition={{ duration: 18 + i * 5, repeat: Infinity, ease: 'easeInOut' }}
            />
          ))}
        </div>
      )}

      {!off && <PrecipCanvas kind={precip} wind={windKmh ?? 0} reduced={reduced} />}

      {condition === 'thunderstorm' && !reduced && <div className="motion-safe-only absolute inset-0 bg-white/70" style={{ animation: 'flash 7s 1s infinite' }} />}

      {/* soft vignette so text stays readable */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/30" />
    </div>
  );
}
