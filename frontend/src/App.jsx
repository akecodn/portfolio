import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";

const columns = [
  "symbol",
  "account",
  "book",
  "quote",
  "fee_currency",
  "qty",
  "avg_open_price",
  "mark_price",
  "fee",
  "fee_usd",
  "realized_pnl",
  "unrealized_pnl",
  "net_pl_usd"
];

const defaultPositionFilters = {
  calcDateFrom: "",
  calcDateTo: ""
};

const DATE_PICKER_MIN = "1900-01-01";
const DATE_PICKER_MAX = "9999-12-31";

const taggedColumns = new Set(["symbol", "quote", "fee_currency"]);
const textColumns = new Set(["symbol", "account", "book", "quote", "fee_currency"]);
const pnlColumns = new Set(["realized_pnl", "unrealized_pnl", "net_pl_usd"]);
const numericColumns = new Set([
  "qty",
  "avg_open_price",
  "mark_price",
  "fee",
  "fee_usd",
  "realized_pnl",
  "unrealized_pnl",
  "net_pl_usd"
]);

ModuleRegistry.registerModules([AllCommunityModule]);

function formatValue(value) {
  if (value === null || value === undefined) return "—";
  const str = String(value);
  if (/^0E-?\d+$/i.test(str)) return "0";
  if (/^-?\d+(\.\d+)?$/.test(str)) {
    return str.includes(".") ? str.replace(/\.?0+$/, "") : str;
  }
  return str;
}

function getNumber(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getPnlClass(column, value) {
  if (!pnlColumns.has(column)) return "";
  const numeric = getNumber(value);
  if (numeric === null || numeric === 0) return "pnl-neutral";
  return numeric > 0 ? "pnl-positive" : "pnl-negative";
}

function renderCell(column, rawValue) {
  const value = formatValue(rawValue);
  if (taggedColumns.has(column) && value !== "—") {
    return <span className={`token token-${column.replaceAll("_", "-")}`}>{value}</span>;
  }
  return value;
}

function parseDateInputToIso(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch;
    const year = Number(yyyy);
    const month = Number(mm);
    const day = Number(dd);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (
      candidate.getUTCFullYear() !== year ||
      candidate.getUTCMonth() !== month - 1 ||
      candidate.getUTCDate() !== day
    ) {
      return null;
    }
    return `${yyyy}-${mm}-${dd}`;
  }

  const legacyMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!legacyMatch) return null;
  const [, dd, mm, yyyy] = legacyMatch;
  const year = Number(yyyy);
  const month = Number(mm);
  const day = Number(dd);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeDatePickerValue(value) {
  if (!value) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

async function getApiErrorMessage(response, fallback) {
  try {
    const payload = await response.json();
    if (payload && typeof payload.detail === "string" && payload.detail) {
      return payload.detail;
    }
  } catch {}
  return fallback;
}

export default function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem("portfolioTheme");
    return savedTheme === "slate" ? "slate" : "light";
  });
  const [activeView, setActiveView] = useState(() => {
    const savedView = localStorage.getItem("portfolioActiveView");
    return savedView === "books" ? "books" : "positions";
  });
  const [rows, setRows] = useState([]);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [positionsLastSyncedAt, setPositionsLastSyncedAt] = useState(null);
  const [error, setError] = useState("");
  const [positionFilters, setPositionFilters] = useState(defaultPositionFilters);
  const [dateFromInputValue, setDateFromInputValue] = useState("");
  const [dateToInputValue, setDateToInputValue] = useState("");
  const [quickFilterText, setQuickFilterText] = useState("");
  const [visibleColumns, setVisibleColumns] = useState(columns);
  const [isPositionsFilterDrawerOpen, setIsPositionsFilterDrawerOpen] = useState(false);
  const [isColumnsDropdownOpen, setIsColumnsDropdownOpen] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [books, setBooks] = useState([]);
  const [booksError, setBooksError] = useState("");
  const [booksLoading, setBooksLoading] = useState(false);
  const [booksSaving, setBooksSaving] = useState(false);
  const [newBookName, setNewBookName] = useState("");
  const [selectedBookId, setSelectedBookId] = useState(null);
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [booksLastSyncedAt, setBooksLastSyncedAt] = useState(null);
  const [accountsFilter, setAccountsFilter] = useState("all");
  const [isAccountsFilterOpen, setIsAccountsFilterOpen] = useState(false);
  const accountsFilterRef = useRef(null);
  const columnsDropdownRef = useRef(null);
  const isDarkTheme = theme === "slate";

  const defaultColDef = useMemo(
    () => ({
      sortable: true,
      resizable: true,
      suppressHeaderMenuButton: false,
      filter: true,
      floatingFilter: false
    }),
    []
  );

  const columnDefs = useMemo(
    () =>
      visibleColumns.map((col) => ({
        field: col,
        headerName: col.replaceAll("_", " "),
        minWidth: textColumns.has(col) ? 145 : 130,
        flex: textColumns.has(col) ? 1.2 : 1,
        filter: numericColumns.has(col) ? "agNumberColumnFilter" : "agTextColumnFilter",
        cellClass: (params) =>
          [textColumns.has(col) ? "cell-text" : "cell-num", getPnlClass(col, params.value)]
            .filter(Boolean)
            .join(" "),
        cellRenderer: (params) => renderCell(col, params.value),
        comparator: (a, b) => {
          const numA = getNumber(a);
          const numB = getNumber(b);
          if (numA !== null && numB !== null) return numA - numB;
          return String(a ?? "").localeCompare(String(b ?? ""));
        }
      })),
    [visibleColumns]
  );

  const selectedBook = useMemo(
    () => books.find((book) => book.id === selectedBookId) ?? null,
    [books, selectedBookId]
  );

  const assignedAccountsSet = useMemo(() => {
    const assigned = new Set();
    books.forEach((book) => {
      book.accounts.forEach((account) => assigned.add(account));
    });
    return assigned;
  }, [books]);

  const unassignedAccounts = useMemo(
    () => accounts.filter((account) => !assignedAccountsSet.has(account)),
    [accounts, assignedAccountsSet]
  );

  const unassignedAccountsSet = useMemo(
    () => new Set(unassignedAccounts),
    [unassignedAccounts]
  );

  const visibleAccounts = useMemo(() => {
    if (accountsFilter === "new") {
      return accounts.filter((account) => unassignedAccountsSet.has(account));
    }
    if (accountsFilter === "assigned") {
      return accounts.filter((account) => !unassignedAccountsSet.has(account));
    }
    return accounts;
  }, [accounts, accountsFilter, unassignedAccountsSet]);

  const allVisibleAccountsSelected = useMemo(() => {
    if (!selectedBook || visibleAccounts.length === 0) return false;
    return visibleAccounts.every((account) => selectedAccounts.includes(account));
  }, [selectedBook, visibleAccounts, selectedAccounts]);

  const accountFilterOptions = useMemo(
    () => [
      { value: "all", label: "All accounts", count: accounts.length },
      { value: "new", label: "Only new", count: unassignedAccounts.length },
      { value: "assigned", label: "Only assigned", count: accounts.length - unassignedAccounts.length }
    ],
    [accounts.length, unassignedAccounts.length]
  );

  const selectedAccountFilterOption = useMemo(
    () =>
      accountFilterOptions.find((option) => option.value === accountsFilter) ??
      accountFilterOptions[0],
    [accountFilterOptions, accountsFilter]
  );

  const getPositionRowId = useCallback(
    (params) => {
      const row = params.data ?? {};
      return [
        row.symbol ?? "",
        row.account ?? "",
        row.book ?? "",
        row.quote ?? "",
        row.fee_currency ?? ""
      ].join("|");
    },
    []
  );

  async function syncBooksSummary() {
    try {
      const [accountsRes, booksRes] = await Promise.all([
        fetch("/api/accounts"),
        fetch("/api/books")
      ]);
      if (!accountsRes.ok || !booksRes.ok) return;

      const accountsData = await accountsRes.json();
      const booksData = await booksRes.json();
      const nextAccounts = Array.isArray(accountsData) ? accountsData : [];
      const nextBooks = Array.isArray(booksData) ? booksData : [];

      setAccounts(nextAccounts);
      setBooks(nextBooks);
    } catch {}
  }

  async function loadPositions(filters = positionFilters) {
    setPositionsLoading(true);
    setError("");

    const params = new URLSearchParams();
    if (filters.calcDateFrom) params.set("calc_date_from", filters.calcDateFrom);
    if (filters.calcDateTo) params.set("calc_date_to", filters.calcDateTo);

    const query = params.toString();
    const url = query ? `/api/positions?${query}` : "/api/positions";

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
      setPositionsLastSyncedAt(new Date());
      syncBooksSummary();
      setError("");
    } catch {
      setError("Unable to load data. Please contact your administrator.");
    } finally {
      setPositionsLoading(false);
    }
  }

  function resetPositionFilters() {
    setPositionFilters(defaultPositionFilters);
    setDateFromInputValue("");
    setDateToInputValue("");
    setQuickFilterText("");
    loadPositions(defaultPositionFilters);
  }

  function applyDateFilter() {
    const parsedFrom = dateFromInputValue ? parseDateInputToIso(dateFromInputValue) : "";
    const parsedTo = dateToInputValue ? parseDateInputToIso(dateToInputValue) : "";

    if (parsedFrom === null || parsedTo === null) {
      setError("Use calendar date format.");
      return;
    }

    if (parsedFrom && parsedTo && parsedFrom > parsedTo) {
      setError("Start date cannot be later than end date.");
      return;
    }

    const nextFilters = { calcDateFrom: parsedFrom || "", calcDateTo: parsedTo || "" };
    setPositionFilters(nextFilters);
    loadPositions(nextFilters);
  }

  function handleDateFromInputChange(event) {
    const next = normalizeDatePickerValue(event.target.value);
    if (next === null) return;
    setDateFromInputValue(next);
  }

  function handleDateToInputChange(event) {
    const next = normalizeDatePickerValue(event.target.value);
    if (next === null) return;
    setDateToInputValue(next);
  }

  function toggleVisibleColumn(column) {
    setVisibleColumns((prev) => {
      if (prev.includes(column)) {
        if (prev.length === 1) return prev;
        const next = new Set(prev.filter((item) => item !== column));
        return columns.filter((item) => next.has(item));
      }
      const next = new Set([...prev, column]);
      return columns.filter((item) => next.has(item));
    });
  }

  async function loadBooksData(preferredBookId = null) {
    setBooksLoading(true);
    setBooksError("");
    try {
      const [accountsRes, booksRes] = await Promise.all([
        fetch("/api/accounts"),
        fetch("/api/books")
      ]);

      if (!accountsRes.ok) {
        throw new Error(await getApiErrorMessage(accountsRes, "Unable to load accounts."));
      }
      if (!booksRes.ok) {
        throw new Error(await getApiErrorMessage(booksRes, "Unable to load books."));
      }

      const accountsData = await accountsRes.json();
      const booksData = await booksRes.json();
      const nextAccounts = Array.isArray(accountsData) ? accountsData : [];
      const nextBooks = Array.isArray(booksData) ? booksData : [];

      setAccounts(nextAccounts);
      setBooks(nextBooks);

      const fallbackId = preferredBookId ?? selectedBookId;
      const preferredBook =
        fallbackId !== null ? nextBooks.find((book) => book.id === fallbackId) : null;
      const nextSelectedBook = preferredBook ?? nextBooks[0] ?? null;
      setSelectedBookId(nextSelectedBook ? nextSelectedBook.id : null);
      setSelectedAccounts(nextSelectedBook ? [...nextSelectedBook.accounts] : []);
      setBooksLastSyncedAt(new Date());
    } catch (loadError) {
      setBooksError(loadError.message || "Unable to load books.");
    } finally {
      setBooksLoading(false);
    }
  }

  useEffect(() => {
    loadPositions();
    syncBooksSummary();
  }, []);

  useEffect(() => {
    localStorage.setItem("portfolioTheme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("portfolioActiveView", activeView);
  }, [activeView]);

  useEffect(() => {
    if (activeView === "books") {
      loadBooksData();
    }
  }, [activeView]);

  useEffect(() => {
    if (activeView !== "positions") {
      setIsPositionsFilterDrawerOpen(false);
    }
  }, [activeView]);

  useEffect(() => {
    if (!isAccountsFilterOpen) return;

    function handlePointerDown(event) {
      if (accountsFilterRef.current && !accountsFilterRef.current.contains(event.target)) {
        setIsAccountsFilterOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setIsAccountsFilterOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isAccountsFilterOpen]);

  useEffect(() => {
    if (!isColumnsDropdownOpen) return;

    function handlePointerDown(event) {
      if (columnsDropdownRef.current && !columnsDropdownRef.current.contains(event.target)) {
        setIsColumnsDropdownOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setIsColumnsDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isColumnsDropdownOpen]);

  useEffect(() => {
    if (!isUserMenuOpen) return;

    function handleEscape(event) {
      if (event.key === "Escape") {
        setIsUserMenuOpen(false);
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isUserMenuOpen]);

  function toggleAccountSelection(account) {
    setSelectedAccounts((prev) =>
      prev.includes(account) ? prev.filter((item) => item !== account) : [...prev, account]
    );
  }

  function toggleAllVisibleAccounts() {
    if (!selectedBook || visibleAccounts.length === 0) return;

    setSelectedAccounts((prev) => {
      const visibleSet = new Set(visibleAccounts);
      const allSelected = visibleAccounts.every((account) => prev.includes(account));

      if (allSelected) {
        return prev.filter((account) => !visibleSet.has(account));
      }

      const next = [...prev];
      visibleAccounts.forEach((account) => {
        if (!next.includes(account)) {
          next.push(account);
        }
      });
      return next;
    });
  }

  async function handleCreateBook(event) {
    event.preventDefault();
    const bookName = newBookName.trim();
    if (!bookName) {
      setBooksError("Book name is required.");
      return;
    }

    setBooksSaving(true);
    setBooksError("");
    try {
      const response = await fetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: bookName })
      });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Unable to create book."));
      }
      const createdBook = await response.json();
      setNewBookName("");
      await loadBooksData(createdBook.id);
    } catch (createError) {
      setBooksError(createError.message || "Unable to create book.");
    } finally {
      setBooksSaving(false);
    }
  }

  async function handleSaveAccounts() {
    if (!selectedBook) return;
    setBooksSaving(true);
    setBooksError("");
    try {
      const response = await fetch(`/api/books/${selectedBook.id}/accounts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts: selectedAccounts })
      });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Unable to save accounts."));
      }

      const updatedBook = await response.json();
      setBooks((prev) =>
        prev.map((book) => (book.id === updatedBook.id ? updatedBook : book))
      );
      setSelectedAccounts([...updatedBook.accounts]);
      loadPositions();
    } catch (saveError) {
      setBooksError(saveError.message || "Unable to save accounts.");
    } finally {
      setBooksSaving(false);
    }
  }

  async function handleDeleteBook() {
    if (!selectedBook) return;
    const shouldDelete = window.confirm(`Delete book "${selectedBook.name}"?`);
    if (!shouldDelete) return;

    setBooksSaving(true);
    setBooksError("");
    try {
      const response = await fetch(`/api/books/${selectedBook.id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Unable to delete book."));
      }
      await loadBooksData();
      loadPositions();
    } catch (deleteError) {
      setBooksError(deleteError.message || "Unable to delete book.");
    } finally {
      setBooksSaving(false);
    }
  }

  return (
    <div
      className={`shell theme-${theme} ${isSidebarOpen ? "sidebar-open" : "sidebar-closed"} ${
        activeView === "positions" && isPositionsFilterDrawerOpen ? "filters-open" : "filters-closed"
      }`}
    >
      <button
        type="button"
        className="sidebar-toggle"
        onClick={() => setIsSidebarOpen((prev) => !prev)}
        aria-label={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
      >
        {isSidebarOpen ? "✕" : "☰"}
      </button>
      <div className="top-user-wrap">
        <button
          type="button"
          className="top-user-toggle"
          aria-label="User menu"
          aria-expanded={isUserMenuOpen}
          onClick={() => setIsUserMenuOpen((prev) => !prev)}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path
              fillRule="evenodd"
              d="M18.685 19.097A9.723 9.723 0 0 0 21.75 12c0-5.385-4.365-9.75-9.75-9.75S2.25 6.615 2.25 12a9.723 9.723 0 0 0 3.065 7.097A9.716 9.716 0 0 0 12 21.75a9.716 9.716 0 0 0 6.685-2.653Zm-12.54-1.285A7.486 7.486 0 0 1 12 15a7.486 7.486 0 0 1 5.855 2.812A8.224 8.224 0 0 1 12 20.25a8.224 8.224 0 0 1-5.855-2.438ZM15.75 9a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {isUserMenuOpen && (
        <button
          type="button"
          className="user-drawer-backdrop"
          onClick={() => setIsUserMenuOpen(false)}
          aria-label="Close user panel"
        />
      )}

      <aside className={`user-drawer ${isUserMenuOpen ? "is-open" : "is-closed"}`}>
        <div className="user-drawer-head">
          <h2>User</h2>
        </div>
        <div className="user-drawer-profile">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path
              fillRule="evenodd"
              d="M18.685 19.097A9.723 9.723 0 0 0 21.75 12c0-5.385-4.365-9.75-9.75-9.75S2.25 6.615 2.25 12a9.723 9.723 0 0 0 3.065 7.097A9.716 9.716 0 0 0 12 21.75a9.716 9.716 0 0 0 6.685-2.653Zm-12.54-1.285A7.486 7.486 0 0 1 12 15a7.486 7.486 0 0 1 5.855 2.812A8.224 8.224 0 0 1 12 20.25a8.224 8.224 0 0 1-5.855-2.438ZM15.75 9a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
              clipRule="evenodd"
            />
          </svg>
          <div className="user-drawer-meta">
            <div className="user-drawer-name">Kira Gryumova</div>
            <div className="user-drawer-role">Portfolio User</div>
          </div>
        </div>
        <label className="user-theme-field">
          <button
            type="button"
            className={`user-theme-toggle ${isDarkTheme ? "is-dark" : "is-light"}`}
            onClick={() => setTheme((prev) => (prev === "slate" ? "light" : "slate"))}
            aria-label={isDarkTheme ? "Switch to light theme" : "Switch to dark theme"}
            aria-pressed={isDarkTheme}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 2.25a.75.75 0 0 1 .75.75v2.25a.75.75 0 0 1-1.5 0V3a.75.75 0 0 1 .75-.75ZM7.5 12a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM18.894 6.166a.75.75 0 0 0-1.06-1.06l-1.591 1.59a.75.75 0 1 0 1.06 1.061l1.591-1.59ZM21.75 12a.75.75 0 0 1-.75.75h-2.25a.75.75 0 0 1 0-1.5H21a.75.75 0 0 1 .75.75ZM17.834 18.894a.75.75 0 0 0 1.06-1.06l-1.59-1.591a.75.75 0 1 0-1.061 1.06l1.59 1.591ZM12 18a.75.75 0 0 1 .75.75V21a.75.75 0 0 1-1.5 0v-2.25A.75.75 0 0 1 12 18ZM7.758 17.303a.75.75 0 0 0-1.061-1.06l-1.591 1.59a.75.75 0 0 0 1.06 1.061l1.591-1.59ZM6 12a.75.75 0 0 1-.75.75H3a.75.75 0 0 1 0-1.5h2.25A.75.75 0 0 1 6 12ZM6.697 7.757a.75.75 0 0 0 1.06-1.06l-1.59-1.591a.75.75 0 0 0-1.061 1.06l1.59 1.591Z" />
            </svg>
            <span className="user-theme-toggle-switch">
              <span className="user-theme-toggle-knob" />
            </span>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path
                fillRule="evenodd"
                d="M9.528 1.718a.75.75 0 0 1 .162.819A8.97 8.97 0 0 0 9 6a9 9 0 0 0 9 9 8.97 8.97 0 0 0 3.463-.69.75.75 0 0 1 .981.98 10.503 10.503 0 0 1-9.694 6.46c-5.799 0-10.5-4.7-10.5-10.5 0-4.368 2.667-8.112 6.46-9.694a.75.75 0 0 1 .818.162Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </label>
      </aside>

      <aside className={`sidebar ${isSidebarOpen ? "is-open" : "is-closed"}`}>
        <div className="sidebar-nav">
          <button
            type="button"
            className={`sidebar-link ${activeView === "positions" ? "is-active" : ""}`}
            onClick={() => setActiveView("positions")}
          >
            Positions
          </button>
          <button
            type="button"
            className={`sidebar-link ${activeView === "books" ? "is-active" : ""}`}
            onClick={() => setActiveView("books")}
          >
            <span>Books</span>
            {unassignedAccounts.length > 0 && (
              <span className="sidebar-badge">{unassignedAccounts.length}</span>
            )}
          </button>
        </div>
      </aside>

      <main className="workspace">
        {activeView === "positions" && (
          <div className="page positions-page">
            <header className="header">
              <div className="header-title-block">
                <h1 className="page-title">
                  <span className="page-title-parent">Portfolio</span>
                  <span className="page-title-separator">/</span>
                  <span className="page-title-current">Positions & PnL</span>
                </h1>
              </div>
            </header>

            <section className="positions-toolbar">
              <div className="positions-toolbar-left">
                <input
                  className="positions-quick-filter-input"
                  type="text"
                  placeholder="Quick filter"
                  value={quickFilterText}
                  onChange={(event) => setQuickFilterText(event.target.value)}
                />
              </div>
              <div className="positions-toolbar-right">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => loadPositions()}
                  disabled={positionsLoading}
                >
                  Refresh
                </button>
                <div className="positions-columns-dropdown" ref={columnsDropdownRef}>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setIsColumnsDropdownOpen((prev) => !prev)}
                    aria-haspopup="menu"
                    aria-expanded={isColumnsDropdownOpen}
                  >
                    Column Filters ▾
                  </button>
                  {isColumnsDropdownOpen && (
                    <div className="positions-columns-dropdown-menu" role="menu">
                      {columns.map((column) => (
                        <label key={column} className="column-toggle">
                          <input
                            type="checkbox"
                            checked={visibleColumns.includes(column)}
                            onChange={() => toggleVisibleColumn(column)}
                          />
                          <span>{column.replaceAll("_", " ")}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setIsPositionsFilterDrawerOpen((prev) => !prev)}
                >
                  ≡ Filters
                </button>
              </div>
            </section>

            {error && <div className="error">{error}</div>}
            <section className="table-card ag-theme-quartz">
              <AgGridReact
                containerStyle={{ height: "100%", width: "100%" }}
                rowData={rows}
                columnDefs={columnDefs}
                defaultColDef={defaultColDef}
                quickFilterText={quickFilterText}
                suppressNoRowsOverlay
                rowHeight={42}
                headerHeight={44}
                getRowId={getPositionRowId}
                suppressScrollOnNewData
                pagination
                paginationPageSize={25}
                paginationPageSizeSelector={[25, 50, 100]}
                animateRows={false}
              />
              {positionsLastSyncedAt && (
                <div className="table-footer-sync">
                  Updated {positionsLastSyncedAt.toLocaleTimeString()}
                </div>
              )}
              {rows.length === 0 && (
                <div className="grid-fallback-empty">
                  {positionsLoading
                    ? "Loading positions..."
                    : error
                    ? "Unable to load data. Please contact your administrator."
                    : "No data available. Please contact your administrator."}
                </div>
              )}
            </section>
          </div>
        )}

        {activeView === "books" && (
          <div className="books-page">
            <header className="header header-with-actions">
              <div className="header-title-block">
                <h1 className="page-title">
                  <span className="page-title-parent">Portfolio</span>
                  <span className="page-title-separator">/</span>
                  <span className="page-title-current">Books</span>
                </h1>
              </div>
              <div className="header-actions">
                {booksLastSyncedAt && (
                  <span className="sync-note">
                    Updated {booksLastSyncedAt.toLocaleTimeString()}
                  </span>
                )}
                <button
                  type="button"
                  className="secondary-button books-refresh-button"
                  onClick={() => loadBooksData()}
                  disabled={booksLoading || booksSaving}
                >
                  Refresh
                </button>
              </div>
            </header>

            {booksError && <div className="error">{booksError}</div>}
            <section className="books-grid">
              <div className="books-card">
                <h2>Books</h2>
                <form className="book-create" onSubmit={handleCreateBook}>
                  <input
                    className="book-input"
                    type="text"
                    value={newBookName}
                    onChange={(event) => setNewBookName(event.target.value)}
                    placeholder="Book name"
                    disabled={booksSaving}
                  />
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={booksSaving || newBookName.trim() === ""}
                  >
                    Create Book
                  </button>
                </form>

                <div className="books-list">
                  {booksLoading && <div className="books-empty">Loading books...</div>}
                  {!booksLoading && books.length === 0 && (
                    <div className="books-empty">No books yet. Create your first one.</div>
                  )}
                  {!booksLoading &&
                    books.map((book) => (
                      <button
                        key={book.id}
                        type="button"
                        className={`book-item ${selectedBookId === book.id ? "is-active" : ""}`}
                        onClick={() => {
                          setSelectedBookId(book.id);
                          setSelectedAccounts([...book.accounts]);
                        }}
                      >
                        <span className="book-item-name">{book.name}</span>
                        <span className="book-item-meta">{book.accounts.length} accounts</span>
                      </button>
                    ))}
                </div>
              </div>

              <div className="books-card">
                <h2>Accounts</h2>

                <div className="accounts-filter-row">
                  <div className="accounts-filter-select-wrap" ref={accountsFilterRef}>
                    <button
                      type="button"
                      className={`accounts-filter-trigger ${isAccountsFilterOpen ? "is-open" : ""}`}
                      disabled={booksSaving || booksLoading}
                      onClick={() => setIsAccountsFilterOpen((prev) => !prev)}
                      aria-haspopup="listbox"
                      aria-expanded={isAccountsFilterOpen}
                      aria-label="Accounts filter"
                    >
                      <span>{`${selectedAccountFilterOption.label} (${selectedAccountFilterOption.count})`}</span>
                    </button>
                    <span className="accounts-filter-chevron" aria-hidden>
                      ▾
                    </span>

                    {isAccountsFilterOpen && (
                      <div className="accounts-filter-menu" role="listbox" aria-label="Accounts filter options">
                        {accountFilterOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            role="option"
                            aria-selected={accountsFilter === option.value}
                            className={`accounts-filter-option ${
                              accountsFilter === option.value ? "is-active" : ""
                            }`}
                            onClick={() => {
                              setAccountsFilter(option.value);
                              setIsAccountsFilterOpen(false);
                            }}
                          >
                            <span>{option.label}</span>
                            <span className="accounts-filter-count">{option.count}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {!selectedBook && (
                  <div className="books-empty">Select a book to assign accounts.</div>
                )}
                {selectedBook && (
                  <>
                    <div className="book-selected-head">
                      <div>
                        <div className="book-item-name">{selectedBook.name}</div>
                        <div className="book-item-meta">
                          {selectedAccounts.length} selected accounts
                        </div>
                      </div>
                      <button
                        type="button"
                        className="danger-button"
                        onClick={handleDeleteBook}
                        disabled={booksSaving}
                      >
                        Delete Book
                      </button>
                    </div>

                    <div className="accounts-list">
                      {visibleAccounts.length === 0 && (
                        <div className="books-empty">
                          {accounts.length === 0
                            ? "No accounts found in database yet."
                            : "No accounts for selected filter."}
                        </div>
                      )}
                      {visibleAccounts.map((account) => (
                        <label
                          key={account}
                          className={`account-row ${
                            unassignedAccountsSet.has(account) ? "is-unassigned" : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedAccounts.includes(account)}
                            onChange={() => toggleAccountSelection(account)}
                            disabled={booksSaving}
                          />
                          <span>{account}</span>
                          {unassignedAccountsSet.has(account) && (
                            <span className="account-state-tag">NEW</span>
                          )}
                        </label>
                      ))}
                    </div>

                    <div className="books-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={toggleAllVisibleAccounts}
                        disabled={booksSaving || visibleAccounts.length === 0}
                      >
                        {allVisibleAccountsSelected ? "Clear All" : "Select All"}
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={handleSaveAccounts}
                        disabled={booksSaving}
                      >
                        Save Accounts
                      </button>
                    </div>
                  </>
                )}
              </div>
            </section>
          </div>
        )}
      </main>

      <aside
        className={`positions-filter-drawer ${
          activeView === "positions" && isPositionsFilterDrawerOpen ? "is-open" : "is-closed"
        }`}
      >
        <div className="positions-filter-drawer-head">
          <h2>Filters</h2>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setIsPositionsFilterDrawerOpen(false)}
          >
            Close
          </button>
        </div>
        <label className="position-filter">
          <span>Date From</span>
          <input
            type="date"
            min={DATE_PICKER_MIN}
            max={DATE_PICKER_MAX}
            lang="en-GB"
            title="DD/MM/YYYY"
            value={dateFromInputValue}
            onChange={handleDateFromInputChange}
          />
        </label>
        <label className="position-filter">
          <span>Date To</span>
          <input
            type="date"
            min={DATE_PICKER_MIN}
            max={DATE_PICKER_MAX}
            lang="en-GB"
            title="DD/MM/YYYY"
            value={dateToInputValue}
            onChange={handleDateToInputChange}
          />
        </label>
        <div className="positions-filter-actions">
          <button
            type="button"
            className="primary-button"
            onClick={applyDateFilter}
            disabled={positionsLoading}
          >
            Apply Date
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={resetPositionFilters}
            disabled={positionsLoading}
          >
            Clear Date
          </button>
        </div>
      </aside>
    </div>
  );
}
