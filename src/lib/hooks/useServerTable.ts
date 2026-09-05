"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PaginatedResult } from "@/types";

/**
 * Generic client hook for admin/trader tables backed by a paginated API
 * route. Debounces search input and re-fetches whenever search/filter/page
 * change, exposing loading/error state so tables never fake interactivity.
 */
export function useServerTable<T>(baseUrl: string, extraParams: Record<string, string>) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaginatedResult<T>>({ items: [], total: 0, page: 1, pageSize: 10, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const extraKey = JSON.stringify(extraParams);

  const fetchData = useCallback(
    async (searchValue: string, pageValue: number) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ search: searchValue, page: String(pageValue), ...JSON.parse(extraKey) });
        const res = await fetch(`${baseUrl}?${params.toString()}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Failed to load data");
        }
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    },
    [baseUrl, extraKey],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchData(search, page);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, page, extraKey]);

  // Reset to page 1 whenever the search/filter identity changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
     
  }, [extraKey]);

  return { search, setSearch, page, setPage, data, loading, error, refetch: () => fetchData(search, page) };
}
