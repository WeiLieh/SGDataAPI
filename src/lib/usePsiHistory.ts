import { useCallback, useEffect, useState } from "react";
import type { PsiData } from "../../shared/datasets/psi";
import { sgtDate } from "../../shared/sgt";
import { needsPreviousDay } from "./psiHistory";
import { requestDataset, useAutoRefresh, type FetchFailure } from "./useDataset";

export interface PsiHistoryState {
  /** Readings from today (and yesterday when the 12 hours reach back past midnight). */
  data: PsiData | null;
  /** When data.gov.sg was read, for the licence credit. */
  fetchedAt: string | null;
  error: FetchFailure | null;
  loading: boolean;
}

/** Joins two days of PSI: regions in today's order (plus any only in yesterday), readings oldest first. */
export function mergePsiDays(older: PsiData, newer: PsiData): PsiData {
  const regions = [...newer.regions];
  for (const region of older.regions) if (!regions.some((r) => r.id === region.id)) regions.push(region);
  const byInstant = new Map<number, PsiData["readings"][number]>();
  for (const reading of [...older.readings, ...newer.readings]) {
    const values: Record<string, number | null> = {};
    for (const region of regions) values[region.id] = reading.values[region.id] ?? null;
    byInstant.set(Date.parse(reading.timestamp), { ...reading, values });
  }
  const readings = [...byInstant.entries()].sort(([a], [b]) => a - b).map(([, r]) => r);
  return { regions, readings };
}

/**
 * Loads the latest 12 hours of PSI: today's readings, plus yesterday's when needed. A 404 for
 * today (just after midnight, before the first reading) is not a failure: yesterday is used.
 * Any other failure is shown as a failure; nothing is substituted.
 */
export function usePsiHistory(): { state: PsiHistoryState; refresh: () => void } {
  const [state, setState] = useState<PsiHistoryState>({ data: null, fetchedAt: null, error: null, loading: true });
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const fail = (error: FetchFailure) => setState({ data: null, fetchedAt: null, error, loading: false });
    setState((previous) => ({ ...previous, loading: true }));

    (async () => {
      const now = new Date();
      const today = sgtDate(now);
      const yesterday = sgtDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));

      const first = await requestDataset<PsiData>("psi", { date: today }, controller.signal);
      if (!first) return;
      const todayEmpty = !first.ok && first.error.httpStatus === 404;
      if (!first.ok && !todayEmpty) return fail(first.error);

      const latest = first.ok ? first.response.data.readings.at(-1) : undefined;
      if (first.ok && latest && !needsPreviousDay(latest.timestamp)) {
        setState({ data: first.response.data, fetchedAt: first.response.fetchedAt, error: null, loading: false });
        return;
      }

      const second = await requestDataset<PsiData>("psi", { date: yesterday }, controller.signal);
      if (!second) return;
      if (!second.ok) return fail(second.error);
      const data = first.ok ? mergePsiDays(second.response.data, first.response.data) : second.response.data;
      const fetchedAt = first.ok ? first.response.fetchedAt : second.response.fetchedAt;
      setState({ data, fetchedAt, error: null, loading: false });
    })();

    return () => controller.abort();
  }, [attempt]);

  useAutoRefresh(refresh);
  return { state, refresh };
}
