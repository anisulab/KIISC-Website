import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

const KEY = 'kiisc.lastActivity';
const EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;

/**
 * Signs out after `minutes` without keyboard, mouse or touch activity in any
 * tab, so a staff screen left open on a shared office computer does not stay
 * signed in. Activity is shared between tabs through localStorage.
 */
export function useIdleSignOut(enabled: boolean, minutes = 30) {
  useEffect(() => {
    if (!enabled || !supabase) return;
    const limit = minutes * 60_000;
    let last = Date.now();
    const write = (v: number) => {
      try {
        localStorage.setItem(KEY, String(v));
      } catch {
        // Storage unavailable: this tab's own timer still applies.
      }
    };
    const read = () => {
      try {
        return Number(localStorage.getItem(KEY)) || last;
      } catch {
        return last;
      }
    };
    let lastWrite = 0;
    const onActivity = () => {
      last = Date.now();
      if (last - lastWrite > 15_000) {
        lastWrite = last;
        write(last);
      }
    };
    write(last);
    for (const e of EVENTS) window.addEventListener(e, onActivity, { passive: true });
    const timer = window.setInterval(async () => {
      if (Date.now() - Math.max(last, read()) < limit) return;
      window.clearInterval(timer);
      await supabase!.auth.signOut();
      window.location.assign('/login?reason=idle');
    }, 30_000);
    return () => {
      window.clearInterval(timer);
      for (const e of EVENTS) window.removeEventListener(e, onActivity);
    };
  }, [enabled, minutes]);
}
