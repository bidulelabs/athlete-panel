import type { Metadata } from 'next';
import './globals.css';
import { UiProvider } from '@athlete-panel/ui';

export const metadata: Metadata = { title: { default: 'Athlete Panel · Your training workspace', template: '%s · Athlete Panel' }, description: 'Your private training calendar, activities and health history.' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-theme="dark" suppressHydrationWarning><body><UiProvider>{children}</UiProvider></body></html>;
}
