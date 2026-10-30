import type { Condition } from '@/lib/types';
import { CONDITION_LABELS } from '@/lib/conditions';

interface Props {
  condition: Condition | null | undefined;
  night?: boolean;
  size?: number;
  animate?: boolean;
  className?: string;
}

const CLOUD = 'M20 46h26a10 10 0 0 0 1-19.95A14 14 0 0 0 20.2 24 11 11 0 0 0 20 46Z';

function Sun({ cx = 32, cy = 32, r = 11, animate }: { cx?: number; cy?: number; r?: number; animate?: boolean }) {
  return (
    <g>
      <g style={animate ? { transformOrigin: `${cx}px ${cy}px`, animation: 'spin-slow 24s linear infinite' } : undefined} className="motion-safe-only">
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4;
          return (
            <line
              key={i}
              x1={cx + Math.cos(a) * (r + 4)}
              y1={cy + Math.sin(a) * (r + 4)}
              x2={cx + Math.cos(a) * (r + 9)}
              y2={cy + Math.sin(a) * (r + 9)}
              stroke="#fbbf24"
              strokeWidth={3}
              strokeLinecap="round"
            />
          );
        })}
      </g>
      <circle cx={cx} cy={cy} r={r} fill="url(#sun-g)" />
    </g>
  );
}

function Moon({ cx = 32, cy = 30, r = 12 }: { cx?: number; cy?: number; r?: number }) {
  return <path d={`M${cx + r * 0.3} ${cy - r} a${r} ${r} 0 1 0 ${r * 0.75} ${r * 1.55} a${r * 0.85} ${r * 0.85} 0 1 1 -${r * 0.75} -${r * 1.55}Z`} fill="url(#moon-g)" />;
}

function Cloud({ dark, dx = 0, dy = 0, scale = 1, animate }: { dark?: boolean; dx?: number; dy?: number; scale?: number; animate?: boolean }) {
  return (
    <g transform={`translate(${dx} ${dy}) scale(${scale})`}>
      <path d={CLOUD} fill={dark ? 'url(#cloud-dark)' : 'url(#cloud-g)'} style={animate ? { animation: 'bob 5s ease-in-out infinite' } : undefined} className="motion-safe-only" />
    </g>
  );
}

function Drops({ n, color = '#60a5fa', animate, short }: { n: number; color?: string; animate?: boolean; short?: boolean }) {
  const xs = n === 2 ? [26, 38] : n === 3 ? [22, 32, 42] : [20, 28, 36, 44];
  return (
    <g>
      {xs.map((x, i) => (
        <line
          key={x}
          x1={x}
          y1={50}
          x2={x - 2}
          y2={short ? 54 : 58}
          stroke={color}
          strokeWidth={2.6}
          strokeLinecap="round"
          className="motion-safe-only"
          style={animate ? { animation: `fall 1.1s ${i * 0.25}s linear infinite` } : undefined}
        />
      ))}
    </g>
  );
}

function Flakes({ xs = [24, 34, 44], animate }: { xs?: number[]; animate?: boolean }) {
  return (
    <g>
      {xs.map((x, i) => (
        <g key={x} className="motion-safe-only" style={animate ? { animation: `bob 2.4s ${i * 0.3}s ease-in-out infinite` } : undefined}>
          <circle cx={x} cy={55} r={2.4} fill="#e0f2fe" stroke="#93c5fd" strokeWidth={1} />
        </g>
      ))}
    </g>
  );
}

export function WeatherIcon({ condition, night, size = 40, animate = false, className }: Props) {
  const c = condition ?? null;
  const label = c ? CONDITION_LABELS[c] : 'Unknown conditions';
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={label} className={className}>
      <defs>
        <radialGradient id="sun-g" cx="40%" cy="35%">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#f59e0b" />
        </radialGradient>
        <linearGradient id="moon-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f8fafc" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </linearGradient>
        <linearGradient id="cloud-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#dbe4ef" />
        </linearGradient>
        <linearGradient id="cloud-dark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#64748b" />
        </linearGradient>
      </defs>
      {c === null && <text x="32" y="40" textAnchor="middle" fontSize="22" fill="currentColor" opacity={0.5}>?</text>}
      {c === 'clear' && (night ? <Moon /> : <Sun animate={animate} />)}
      {c === 'partly-cloudy' && (
        <>
          {night ? <Moon cx={36} cy={20} r={10} /> : <Sun cx={40} cy={22} r={9} animate={animate} />}
          <Cloud dx={-2} dy={4} animate={animate} />
        </>
      )}
      {c === 'cloudy' && (
        <>
          <Cloud dx={10} dy={-6} scale={0.85} dark />
          <Cloud dy={2} animate={animate} />
        </>
      )}
      {c === 'fog' && (
        <>
          <Cloud dy={-4} />
          {[48, 54, 60].map((y, i) => (
            <line key={y} x1={14 + i * 3} y1={y} x2={50 - i * 2} y2={y} stroke="#94a3b8" strokeWidth={3} strokeLinecap="round" />
          ))}
        </>
      )}
      {c === 'drizzle' && (
        <>
          <Cloud dy={-4} animate={animate} />
          <Drops n={3} short animate={animate} />
        </>
      )}
      {c === 'rain' && (
        <>
          <Cloud dy={-4} animate={animate} />
          <Drops n={3} animate={animate} />
        </>
      )}
      {c === 'heavy-rain' && (
        <>
          <Cloud dy={-4} dark animate={animate} />
          <Drops n={4} color="#3b82f6" animate={animate} />
        </>
      )}
      {c === 'snow' && (
        <>
          <Cloud dy={-4} animate={animate} />
          <Flakes animate={animate} />
        </>
      )}
      {c === 'sleet' && (
        <>
          <Cloud dy={-4} animate={animate} />
          <Drops n={2} short animate={animate} />
          <Flakes xs={[32]} animate={animate} />
        </>
      )}
      {c === 'thunderstorm' && (
        <>
          <Cloud dy={-6} dark animate={animate} />
          <path d="M34 40 L26 52 h6 l-4 10 L40 48 h-6 l4-8Z" fill="#facc15" stroke="#ca8a04" strokeWidth={1} strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}
