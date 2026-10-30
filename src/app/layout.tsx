import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppStateProvider } from '@/components/AppState';
import { Shell } from '@/components/Shell';

export const metadata: Metadata = {
  title: 'Skyline Weather',
  description: 'Multi-source weather dashboard: compare free forecasts, explore history and export to Excel.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f1f4f9' },
    { media: '(prefers-color-scheme: dark)', color: '#090d18' },
  ],
};

// Apply the saved theme before first paint to avoid a light/dark flash.
const themeScript = `try{var s=JSON.parse(localStorage.getItem('weather-dashboard:v1')||'{}');var t=(s.prefs&&s.prefs.theme)||'system';if(t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AppStateProvider>
          <Shell>{children}</Shell>
        </AppStateProvider>
      </body>
    </html>
  );
}
