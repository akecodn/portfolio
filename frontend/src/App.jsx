import { useEffect, useMemo, useRef, useState } from "react";
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

const taggedColumns = new Set(["symbol", "quote", "fee_currency"]);
const textColumns = new Set(["symbol", "account", "book", "quote", "fee_currency"]);
const pnlColumns = new Set(["realized_pnl", "unrealized_pnl", "net_pl_usd"]);

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
  const [activeView, setActiveView] = useState("positions");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
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

  const defaultColDef = useMemo(
    () => ({
      sortable: true,
      resizable: true,
      suppressHeaderMenuButton: true
    }),
    []
  );

  const columnDefs = useMemo(
    () =>
      columns.map((col) => ({
        field: col,
        headerName: col.replaceAll("_", " "),
        minWidth: textColumns.has(col) ? 145 : 130,
        flex: textColumns.has(col) ? 1.2 : 1,
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
    []
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

  function loadPositions() {
    setError("");
    fetch("/api/positions")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setRows(Array.isArray(data) ? data : []);
        setError("");
      })
      .catch(() =>
        setError("Unable to load data. Please contact your administrator.")
      );
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
  }, []);

  useEffect(() => {
    if (activeView === "books") {
      loadBooksData();
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

  function toggleAccountSelection(account) {
    setSelectedAccounts((prev) =>
      prev.includes(account) ? prev.filter((item) => item !== account) : [...prev, account]
    );
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
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">Portfolio</div>
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
          <div className="page">
            <header className="header">
              <div>
                <div className="eyebrow">Portfolio</div>
                <h1>Positions & PnL</h1>
              </div>
            </header>

            {error && <div className="error">{error}</div>}
            <section className="table-card ag-theme-quartz">
              <AgGridReact
                containerStyle={{ height: "100%", width: "100%" }}
                rowData={rows}
                columnDefs={columnDefs}
                defaultColDef={defaultColDef}
                suppressNoRowsOverlay
                rowHeight={42}
                headerHeight={44}
                pagination
                paginationPageSize={25}
                paginationPageSizeSelector={[25, 50, 100]}
                animateRows
              />
              {rows.length === 0 && (
                <div className="grid-fallback-empty">
                  {error
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
              <div>
                <div className="eyebrow">Portfolio</div>
                <h1>Books</h1>
              </div>
              <div className="header-actions">
                {booksLastSyncedAt && (
                  <span className="sync-note">
                    Updated {booksLastSyncedAt.toLocaleTimeString()}
                  </span>
                )}
                <button
                  type="button"
                  className="secondary-button"
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
    </div>
  );
}
