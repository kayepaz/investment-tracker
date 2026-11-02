export type DbTestResult =
  | {
      ok: true;
      sqliteVersion: string;
      storage: string;
      /** Rows written so far, across all runs. Grows by one per run if data persists. */
      rowCount: number;
      firstRunAt: string;
    }
  | {
      ok: false;
      stage: string;
      error: string;
      sqliteVersion?: string;
      inMemoryWorks: boolean;
    };

export type ProviderResult =
  | { ok: true; summary: string }
  | { ok: false; kind: 'blocked' | 'http' | 'bad-response' | 'missing-key'; detail: string };
