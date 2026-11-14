import { useEffect, useState } from 'react';
import type { ApplicationUpdate } from '../shared/types.js';
import { request } from './api.js';

export function AppUpdateNotice() {
  const [update, setUpdate] = useState<ApplicationUpdate | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const check = async () => {
      if (pending || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const result = await request<ApplicationUpdate>('/api/app-update', { signal: controller.signal });
        if (controller.signal.aborted) return;
        const url = result.downloadUrl && new URL(result.downloadUrl);
        const safe = url && url.origin === 'https://github.com' && !url.username && !url.password &&
          /^\/[^/]+\/[^/]+\/releases\/tag\/v?[0-9]+\.[0-9]+\.[0-9]+$/.test(url.pathname) && !url.search && !url.hash;
        setUpdate(result.available && safe && typeof result.latestVersion === 'string' &&
          /^[0-9]+\.[0-9]+\.[0-9]+$/.test(result.latestVersion) ? result : null);
      } catch { /* Update availability must not interrupt ticket work. */ }
      finally { pending = false; }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, 6 * 60 * 60 * 1000);
    document.addEventListener('visibilitychange', check);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', check); };
  }, []);
  if (!update) return null;
  return <aside className="action-notice app-update-notice" role="status">
    <span>Neue Version {update.latestVersion} verfügbar.</span>
    <a href={update.downloadUrl} target="_blank" rel="noreferrer">Download öffnen</a>
  </aside>;
}
