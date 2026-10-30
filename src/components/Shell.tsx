'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from './AppState';

const NAV = [
  { href: '/', label: 'Today', icon: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z' },
  { href: '/compare', label: 'Compare', icon: 'M4 19V9M10 19V5M16 19v-7M22 19H2' },
  { href: '/history', label: 'History', icon: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2' },
  { href: '/import', label: 'Import', icon: 'M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2' },
  { href: '/export', label: 'Export', icon: 'M12 21V9m0 0-4 4m4-4 4 4M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2' },
  { href: '/settings', label: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z' },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { prefs, setPrefs, resolvedTheme } = useApp();
  const isHome = path === '/';
  const toggleTheme = () => setPrefs({ theme: resolvedTheme === 'dark' ? 'light' : 'dark' });

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className={`${isHome ? 'absolute text-white' : 'sticky border-b border-line bg-canvas/85 backdrop-blur'} inset-x-0 top-0 z-40`}>
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4">
          <Link href="/" className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 text-white shadow">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.2 9.5 4.3 4.3 0 0 0 7 18Z" />
              </svg>
            </span>
            <span>Skyline</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((n) => {
              const active = n.href === '/' ? isHome : path.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    active ? (isHome ? 'bg-white/20' : 'bg-surface text-ink shadow-sm') : isHome ? 'text-white/80 hover:bg-white/10 hover:text-white' : 'text-muted hover:text-ink'
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
            <Link href="/sources" className={`rounded-lg px-3 py-1.5 text-sm font-medium ${path === '/sources' ? 'bg-surface text-ink shadow-sm' : isHome ? 'text-white/80 hover:text-white' : 'text-muted hover:text-ink'}`}>
              Sources
            </Link>
          </nav>
          <button onClick={toggleTheme} className={`rounded-lg p-2 ${isHome ? 'hover:bg-white/15' : 'hover:bg-surface'}`} title={`Theme: ${prefs.theme}`} aria-label="Toggle dark mode">
            {resolvedTheme === 'dark' ? <Icon d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /> : <Icon d={NAV[0].icon} />}
          </button>
        </div>
      </header>
      <main>{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur md:hidden" aria-label="Main">
        <div className="mx-auto grid max-w-lg grid-cols-6">
          {NAV.map((n) => {
            const active = n.href === '/' ? isHome : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${active ? 'text-accent' : 'text-muted'}`}>
                <Icon d={n.icon} />
                {n.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
