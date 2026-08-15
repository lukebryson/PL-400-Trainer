// STUB — owned by the store agent. Replace wholesale, keeping these exports.
import { createContext, useContext } from 'react';
import type { Store } from './store-contract';

const notReady = (): never => {
  throw new Error('store not implemented');
};

const stub: Store = {
  ready: false,
  progress: new Map(),
  sessions: [],
  recordAttempt: notReady,
  setCorrection: notReady,
  setNotes: notReady,
  saveSession: notReady,
  exportJson: notReady,
  importJson: notReady,
  resetAll: notReady,
};

const Ctx = createContext<Store>(stub);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  return <Ctx.Provider value={stub}>{children}</Ctx.Provider>;
}

export const useStore = (): Store => useContext(Ctx);
