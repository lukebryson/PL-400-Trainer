/**
 * Hash routing in 40 lines. Deep links matter here (a dashboard "next action"
 * has to be able to point at a filtered drill), but a routing library would be
 * a dependency and a build-size cost for four routes.
 *
 * Owned by the orchestrator.
 */
import { useCallback, useSyncExternalStore } from 'react';

export interface Route {
  path: string;
  params: URLSearchParams;
}

/** Every top-level page takes exactly this. */
export interface PageProps {
  params: URLSearchParams;
}

const parse = (hash: string): Route => {
  const raw = hash.replace(/^#/, '') || '/';
  const [path = '/', query = ''] = raw.split('?');
  return { path: path.startsWith('/') ? path : `/${path}`, params: new URLSearchParams(query) };
};

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export const useRoute = (): Route => {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => '#/',
  );
  return parse(hash);
};

export const navigate = (href: string): void => {
  window.location.hash = href.startsWith('#') ? href.slice(1) : href;
};

export const useNavigate = () => useCallback(navigate, []);

/** Build a href such as `#/drill?area=extend-platform&filter=wrong-twice`. */
export const href = (path: string, params?: Record<string, string | number | undefined>): string => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }
  const q = qs.toString();
  return `#${path}${q ? `?${q}` : ''}`;
};
