import { type FormEvent, useEffect, useMemo, useState } from "react";

type AdminTable = {
  name: string;
  columns: string[];
  editableColumns: string[];
};

type AdminRow = Record<string, string | number | boolean | null>;

type TablesResponse = {
  ok: true;
  tables: AdminTable[];
};

type RowsResponse = {
  ok: true;
  table: string;
  columns: string[];
  editableColumns: string[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  rows: AdminRow[];
};

type PatchResponse = {
  ok: true;
  table: string;
  row: AdminRow | null;
};

type AdminPageProps = {
  apiBaseUrl: string;
};

const ADMIN_PASSWORD_STORAGE_KEY = "pay-to-minwoo-admin-password";

function snakeToCamel(value: string) {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function stringifyCell(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function isLongColumn(column: string) {
  return column.includes("url") || column.includes("payload") || column.includes("metadata") || column.includes("message");
}

function editableClassName(column: string) {
  return isLongColumn(column)
    ? "min-h-[84px] w-full min-w-[320px] rounded-lg border border-surface-variant/30 bg-white px-3 py-2 font-mono text-xs"
    : "w-full min-w-[160px] rounded-lg border border-surface-variant/30 bg-white px-3 py-2 font-mono text-xs";
}

export function AdminPage({ apiBaseUrl }: AdminPageProps) {
  const [adminPassword, setAdminPassword] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [tables, setTables] = useState<AdminTable[]>([]);
  const [activeTable, setActiveTable] = useState<string>("orders");
  const [columns, setColumns] = useState<string[]>([]);
  const [editableColumns, setEditableColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AdminRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  function resetAdminSession(message: string) {
    window.localStorage.removeItem(ADMIN_PASSWORD_STORAGE_KEY);
    setAdminPassword("");
    setTables([]);
    setRows([]);
    setColumns([]);
    setEditableColumns([]);
    setPage(1);
    setTotal(0);
    setTotalPages(1);
    setEditingId(null);
    setDraft(null);
    setError(message);
  }

  async function adminFetch(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    if (adminPassword) {
      headers.set("X-Admin-Password", adminPassword);
    }

    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers
    });

    if (response.status === 401) {
      resetAdminSession("관리자 비밀번호가 올바르지 않습니다.");
      throw new Error("Unauthorized");
    }

    return response;
  }

  async function loadTables() {
    const response = await adminFetch("/api/v1/admin/tables");
    if (!response.ok) {
      throw new Error("Failed to load admin tables.");
    }

    const json = (await response.json()) as TablesResponse;
    setTables(json.tables);
    if (!json.tables.some((table) => table.name === activeTable)) {
      setActiveTable(json.tables[0]?.name ?? "orders");
    }
  }

  async function loadRows(nextPage = page, nextPageSize = pageSize, nextTable = activeTable) {
    setLoading(true);
    setError(null);

    try {
      const response = await adminFetch(`/api/v1/admin/tables/${nextTable}/rows?page=${nextPage}&pageSize=${nextPageSize}`);
      if (!response.ok) {
        throw new Error("Failed to load table rows.");
      }

      const json = (await response.json()) as RowsResponse;
      setColumns(json.columns);
      setEditableColumns(json.editableColumns);
      setRows(json.rows);
      setPage(json.page);
      setPageSize(json.pageSize);
      setTotal(json.total);
      setTotalPages(json.totalPages);
      setEditingId(null);
      setDraft(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unknown admin error.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const savedPassword = window.localStorage.getItem(ADMIN_PASSWORD_STORAGE_KEY) ?? "";
    setAdminPassword(savedPassword);
    setPasswordInput(savedPassword);
  }, []);

  useEffect(() => {
    if (!adminPassword) {
      return;
    }

    void (async () => {
      try {
        await loadTables();
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unknown admin error.");
      }
    })();
  }, [apiBaseUrl, adminPassword]);

  useEffect(() => {
    if (!adminPassword) {
      setLoading(false);
      return;
    }

    void loadRows(1, pageSize, activeTable);
  }, [activeTable, apiBaseUrl, adminPassword]);

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return rows;
    }

    return rows.filter((row) =>
      columns
        .map((column) => stringifyCell(row[snakeToCamel(column)]))
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [rows, columns, query]);

  function startEdit(row: AdminRow) {
    setEditingId(String(row.id));
    setDraft({ ...row });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
  }

  function updateDraft(column: string, value: string) {
    if (!draft) {
      return;
    }

    const key = snakeToCamel(column);
    const currentValue = draft[key];
    const nextValue = typeof currentValue === "number" ? Number(value) : value;
    setDraft({ ...draft, [key]: Number.isNaN(nextValue) ? value : nextValue });
  }

  async function saveRow() {
    if (!editingId || !draft) {
      return;
    }

    setSavingId(editingId);
    setError(null);

    try {
      const values = Object.fromEntries(editableColumns.map((column) => [snakeToCamel(column), draft[snakeToCamel(column)] ?? null]));
      const response = await adminFetch(`/api/v1/admin/tables/${activeTable}/rows/${editingId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ values })
      });

      if (!response.ok) {
        throw new Error("Failed to update row.");
      }

      const json = (await response.json()) as PatchResponse;
      if (!json.row) {
        throw new Error("Updated row is missing.");
      }

      setRows((currentRows) => currentRows.map((row) => (row.id === json.row!.id ? json.row! : row)));
      cancelEdit();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unknown save error.");
    } finally {
      setSavingId(null);
    }
  }

  async function movePage(nextPage: number) {
    await loadRows(Math.min(Math.max(nextPage, 1), totalPages), pageSize, activeTable);
  }

  async function changePageSize(nextPageSize: number) {
    await loadRows(1, nextPageSize, activeTable);
  }

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextPassword = passwordInput.trim();

    if (!nextPassword) {
      setError("관리자 비밀번호를 입력하세요.");
      return;
    }

    window.localStorage.setItem(ADMIN_PASSWORD_STORAGE_KEY, nextPassword);
    setAdminPassword(nextPassword);
    setError(null);
  }

  function logout() {
    setPasswordInput("");
    resetAdminSession("관리자 세션을 종료했습니다.");
  }

  if (!adminPassword) {
    return (
      <main className="w-full max-w-[720px] mx-auto px-6 py-16">
        <section className="rounded-[2rem] border border-surface-variant/20 bg-surface-container-lowest shadow-sm p-8">
          <p className="text-on-surface-variant font-label text-xs uppercase tracking-[0.2em] mb-3">Admin</p>
          <h1 className="font-headline text-4xl font-extrabold tracking-tight text-on-background">Admin Lock</h1>
          <p className="text-on-surface-variant mt-3">
            Turso admin 페이지는 비밀번호가 있어야 열립니다.
          </p>

          {error ? (
            <div className="mt-6 rounded-[1.5rem] bg-error-container/20 px-5 py-4 text-sm text-on-error-container border border-error/10">
              {error}
            </div>
          ) : null}

          <form className="mt-8 flex flex-col gap-4" onSubmit={submitPassword}>
            <input
              className="w-full rounded-[1.25rem] border border-surface-variant/30 bg-white px-4 py-4 text-base text-on-background outline-none"
              placeholder="ADMIN_PASSWORD"
              type="password"
              value={passwordInput}
              onChange={(event) => setPasswordInput(event.target.value)}
            />
            <button
              className="signature-gradient text-on-primary font-headline font-bold py-4 px-6 rounded-full shadow-lg shadow-primary/20 transition-all duration-300 active:scale-[0.98]"
              type="submit"
            >
              들어가기
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="w-full max-w-[1500px] mx-auto px-6 py-12">
      <div className="mb-8 flex items-start justify-between gap-6 flex-wrap">
        <div>
          <p className="text-on-surface-variant font-label text-xs uppercase tracking-[0.2em] mb-3">Admin</p>
          <h1 className="font-headline text-4xl font-extrabold tracking-tight text-on-background">DB Table Editor</h1>
          <p className="text-on-surface-variant mt-3 max-w-3xl">
            Turso 테이블을 페이지 단위로 보고, 행 단위로 수정합니다. 기준 도메인은 `orders`, `payment_attempts`, `provider_events`, `settlement_records`, `ledger_entries`입니다.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            className="min-w-[260px] rounded-full border border-surface-variant/30 bg-surface-container-lowest px-4 py-3 text-sm text-on-background outline-none"
            placeholder="현재 페이지에서 검색"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            className="signature-gradient text-on-primary font-headline font-bold py-3 px-6 rounded-full shadow-lg shadow-primary/20 transition-all duration-300 active:scale-[0.98]"
            onClick={() => void loadRows(page, pageSize, activeTable)}
            type="button"
          >
            새로고침
          </button>
          <button
            className="rounded-full bg-surface-container-low px-5 py-3 text-sm font-semibold text-on-surface"
            onClick={logout}
            type="button"
          >
            잠금
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-6 rounded-[1.5rem] bg-error-container/20 px-5 py-4 text-sm text-on-error-container border border-error/10">
          {error}
        </div>
      ) : null}

      <div className="mb-6 flex items-center gap-3 overflow-x-auto pb-2">
        {tables.map((table) => (
          <button
            key={table.name}
            className={activeTable === table.name ? "rounded-full bg-primary-container px-5 py-3 text-sm font-semibold text-primary whitespace-nowrap" : "rounded-full bg-surface-container-low px-5 py-3 text-sm font-semibold text-on-surface whitespace-nowrap"}
            onClick={() => setActiveTable(table.name)}
            type="button"
          >
            {table.name}
          </button>
        ))}
      </div>

      <section className="rounded-[2rem] border border-surface-variant/20 bg-surface-container-lowest shadow-sm overflow-hidden">
        <div className="border-b border-surface-variant/20 px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-headline text-2xl font-extrabold text-on-background">{activeTable}</h2>
            <p className="text-sm text-on-surface-variant mt-1">
              total {total.toLocaleString("ko-KR")} rows, page {page} / {totalPages}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              className="rounded-full bg-surface-container-low px-4 py-2 text-sm font-semibold text-on-surface disabled:opacity-40"
              disabled={page <= 1 || loading}
              onClick={() => void movePage(page - 1)}
              type="button"
            >
              이전
            </button>
            <button
              className="rounded-full bg-surface-container-low px-4 py-2 text-sm font-semibold text-on-surface disabled:opacity-40"
              disabled={page >= totalPages || loading}
              onClick={() => void movePage(page + 1)}
              type="button"
            >
              다음
            </button>
            <select
              className="rounded-full border border-surface-variant/30 bg-white px-4 py-2 text-sm"
              value={pageSize}
              onChange={(event) => void changePageSize(Number(event.target.value))}
            >
              <option value={10}>10 / page</option>
              <option value={20}>20 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1280px] w-full text-sm">
            <thead className="bg-surface-container-low text-left">
              <tr className="text-on-surface-variant">
                {columns.map((column) => (
                  <th key={column} className="px-4 py-4 font-semibold whitespace-nowrap">
                    {column}
                  </th>
                ))}
                <th className="px-4 py-4 font-semibold">actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-4 py-8 text-on-surface-variant" colSpan={columns.length + 1}>
                    Loading...
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-on-surface-variant" colSpan={columns.length + 1}>
                    No rows.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const rowId = String(row.id);
                  const isEditing = editingId === rowId;

                  return (
                    <tr key={rowId} className="border-t border-surface-variant/10 align-top">
                      {columns.map((column) => {
                        const key = snakeToCamel(column);
                        const isEditable = editableColumns.includes(column);
                        const value = isEditing && draft ? draft[key] : row[key];

                        return (
                          <td key={`${rowId}-${column}`} className="px-4 py-4">
                            {isEditing && isEditable ? (
                              isLongColumn(column) ? (
                                <textarea
                                  className={editableClassName(column)}
                                  value={stringifyCell(value)}
                                  onChange={(event) => updateDraft(column, event.target.value)}
                                />
                              ) : (
                                <input
                                  className={editableClassName(column)}
                                  value={stringifyCell(value)}
                                  onChange={(event) => updateDraft(column, event.target.value)}
                                />
                              )
                            ) : (
                              <span className={isLongColumn(column) ? "block max-w-[420px] break-all font-mono text-xs" : "whitespace-nowrap font-mono text-xs"}>
                                {stringifyCell(value) || "-"}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-4">
                        {isEditing ? (
                          <div className="flex gap-2">
                            <button
                              className="rounded-full bg-primary-container px-4 py-2 text-xs font-semibold text-primary"
                              disabled={savingId === rowId}
                              onClick={() => void saveRow()}
                              type="button"
                            >
                              {savingId === rowId ? "Saving..." : "Save"}
                            </button>
                            <button
                              className="rounded-full bg-surface-container-low px-4 py-2 text-xs font-semibold text-on-surface"
                              disabled={savingId === rowId}
                              onClick={cancelEdit}
                              type="button"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            className="rounded-full bg-surface-container-low px-4 py-2 text-xs font-semibold text-on-surface"
                            onClick={() => startEdit(row)}
                            type="button"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
