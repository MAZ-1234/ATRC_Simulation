/**
 * URL hash mirror (DESIGN.md 5.2): `#/replay?variant=nominal&seed=0&t=518.3&cmp=Baseline`.
 * Every state can be shared and deep-linked. The cursor is written only while paused,
 * so playback does not flood the history. Uses replaceState (no history entries per step).
 * Extra query params owned by views (e.g. Results `sec`) are preserved.
 */
import { useStore, VIEWS, normaliseSelection, type View } from "./store";

export interface HashState {
  view?: View;
  variant?: string;
  seed?: number;
  t?: number;
  cmp?: string;
  /** Any other params, preserved verbatim. */
  extra: Record<string, string>;
}

export function parseHash(hash: string = window.location.hash): HashState {
  const h = hash.replace(/^#\/?/, "");
  const [path, query = ""] = h.split("?");
  const out: HashState = { extra: {} };
  if ((VIEWS as string[]).includes(path)) out.view = path as View;
  const q = new URLSearchParams(query);
  q.forEach((v, k) => {
    if (k === "variant") out.variant = v;
    else if (k === "seed") { const n = Number(v); if (Number.isInteger(n)) out.seed = n; }
    else if (k === "t") { const n = Number(v); if (Number.isFinite(n)) out.t = n; }
    else if (k === "cmp") out.cmp = v;
    else out.extra[k] = v;
  });
  return out;
}

/** Build a hash for a state (used by "Show in replay" links too). */
export function buildHash(s: { view: View; variant: string; seed: number; t?: number; cmp: string; extra?: Record<string, string> }): string {
  const q = new URLSearchParams();
  q.set("variant", s.variant);
  q.set("seed", String(s.seed));
  if (s.t !== undefined) q.set("t", s.t.toFixed(1));
  q.set("cmp", s.cmp);
  for (const [k, v] of Object.entries(s.extra ?? {})) q.set(k, v);
  return `#/${s.view}?${q.toString()}`;
}

/** Navigate to a replay moment (Results "Show in replay"). */
export function showInReplay(opts: { variant?: string; seed?: number; t: number; cmp?: string }): void {
  const st = useStore.getState();
  const sel = normaliseSelection({ variant: opts.variant ?? st.variant, seed: opts.seed ?? st.seed, compare: opts.cmp ?? st.compare });
  useStore.setState({ ...sel, view: "replay", playing: false, stopAt: null, focus: { t: opts.t, kind: "result" } });
  useStore.getState().seek(opts.t);
}

let extraParams: Record<string, string> = {};

/** Read the hash into the store now, then keep both in sync. Returns an unsubscribe. */
export function bindUrlHash(): () => void {
  const applyHash = () => {
    const h = parseHash();
    extraParams = h.extra;
    const st = useStore.getState();
    const sel = normaliseSelection({ variant: h.variant ?? st.variant, seed: h.seed ?? st.seed, compare: h.cmp ?? st.compare });
    useStore.setState({ ...sel, view: h.view ?? st.view });
    if (h.t !== undefined && Math.abs(h.t - st.t) > 0.05) {
      useStore.getState().seek(h.t);
      useStore.setState({ interacted: st.interacted }); // a deep link is not a user interaction
    }
  };
  applyHash();

  let lastWritten = "";
  const write = () => {
    const s = useStore.getState();
    const hash = buildHash({ view: s.view, variant: s.variant, seed: s.seed, cmp: s.compare, t: s.playing ? undefined : s.t, extra: extraParams });
    if (hash !== lastWritten && hash !== window.location.hash) {
      lastWritten = hash;
      try { window.history.replaceState(null, "", hash); } catch { /* file:// in some browsers */ }
    }
  };
  write();
  const unsub = useStore.subscribe((s, p) => {
    if (s.view !== p.view || s.variant !== p.variant || s.seed !== p.seed || s.compare !== p.compare
      || s.playing !== p.playing || (!s.playing && s.t !== p.t)) write();
  });
  const onHash = () => { if (window.location.hash !== lastWritten) applyHash(); };
  window.addEventListener("hashchange", onHash);
  return () => { unsub(); window.removeEventListener("hashchange", onHash); };
}

/** View-owned extra hash params (e.g. Results section). Setting one rewrites the hash. */
export function setHashParam(key: string, value: string | null): void {
  if (value === null) delete extraParams[key];
  else extraParams[key] = value;
  const s = useStore.getState();
  const hash = buildHash({ view: s.view, variant: s.variant, seed: s.seed, cmp: s.compare, t: s.playing ? undefined : s.t, extra: extraParams });
  try { window.history.replaceState(null, "", hash); } catch { /* ignore */ }
}
export function getHashParam(key: string): string | null {
  return extraParams[key] ?? null;
}
