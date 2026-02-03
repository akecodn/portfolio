import { useEffect, useState } from "react";

const columns = [
  "symbol",
  "account",
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

function formatValue(value) {
  if (value === null || value === undefined) return "—";
  const str = String(value);
  if (/^0E-?\d+$/i.test(str)) return "0";
  if (/^-?\d+(\.\d+)?$/.test(str)) {
    return str.includes(".") ? str.replace(/\.?0+$/, "") : str;
  }
  return str;
}

export default function App() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/positions")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setError("Данные не загрузились. Проверь, запущен ли BFF."));
  }, []);

  return (
    <div className="page">
      <header className="header">
        <div>
          <div className="eyebrow">Portfolio</div>
          <h1>Positions & PnL</h1>
        </div>
        <div className="status">Строк: {rows.length}</div>
      </header>

      {error && <div className="error">{error}</div>}
      {!error && rows.length === 0 && (
        <div className="empty">Нет данных для отображения</div>
      )}

      {rows.length > 0 && (
        <section className="table-card">
          <table>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col}>{col.replaceAll("_", " ")}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx}>
                  {columns.map((col) => (
                    <td key={col}>{formatValue(row[col])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
