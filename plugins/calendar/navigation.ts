'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { startOfWeek, useWorkspace } from '@athlete-panel/ui';

/** Scroll only an explicitly requested date, after its range has loaded. */
export function useCalendarNavigation() {
  const { from, weekStartsOn } = useWorkspace();
  const calendarRef = useRef<HTMLElement>(null);
  const navigationRef = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<{ date: string; from: string } | null>(null);

  useLayoutEffect(() => {
    const calendar = calendarRef.current;
    const navigation = navigationRef.current;
    if (!calendar || !navigation) return;
    const root = document.documentElement;
    const previousPadding = root.style.scrollPaddingTop;
    const measure = () => {
      const offset = parseFloat(getComputedStyle(navigation).top) || 0;
      const height = navigation.getBoundingClientRect().height;
      calendar.style.setProperty('--calendar-sticky-height', `${height}px`);
      // Native keyboard focus and scrollIntoView share the same unobscured area.
      root.style.scrollPaddingTop = `${offset + height + 8}px`;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(navigation);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      root.style.scrollPaddingTop = previousPadding;
    };
  }, []);

  useEffect(() => {
    if (!target || from !== target.from) return;
    const day = calendarRef.current?.querySelector<HTMLElement>(`[data-date="${target.date}"]`);
    if (!day) return;
    // Immediate positioning also honors reduced motion and avoids scrolling races
    // with focus restoration, another navigation click or an opening dialog.
    day.scrollIntoView({ block: 'start', behavior: 'instant' });
    setTarget(null);
  }, [from, target]);

  return {
    calendarRef,
    navigationRef,
    navigate: (date: string) => {
      setTarget({ date, from: startOfWeek(date, weekStartsOn) });
    },
  };
}
