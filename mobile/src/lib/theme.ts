export const C = {
  bg1: '#EEF0FF', bg2: '#FDEBF5', card: '#FFFFFF',
  text: '#1E1B4B', muted: '#6B7280',
  primary: '#A78BFA', pink: '#F472B6', soft: '#EDE9FE',
  good: '#10B981', warn: '#F59E0B', bad: '#EF4444', border: '#E5E7EB',
};
export const riskColor = (r?: string) =>
  r === 'High' ? C.bad : r === 'Medium' ? C.warn : C.good;

export const pickStr = (o: any, keys: string[]): string | undefined => {
  for (const k of keys) if (o && typeof o[k] === 'string' && o[k]) return o[k];
  return undefined;
};
export const humanize = (s?: string) =>
  (s ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export const pickNum = (o: any, keys: string[]): number | undefined => {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
  }
  return undefined;
};