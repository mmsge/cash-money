import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const MONTHS = [
  "Januar",
  "Februar",
  "Mars",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Desember",
];

const FLAG_COLORS = ["#d97706", "#0f766e", "#2563eb", "#be123c", "#6d28d9", "#4d7c0f"];

const sampleText = `Årslønn (heltid)
Gyldig fra\tGyldig til\tNY VERDI
2026-05-01\t
NOK 860000
2025-05-01\t2026-04-30
NOK 815000
2024-05-01\t2025-04-30
NOK 765000
2023-05-01\t2024-04-30
NOK 720000
2022-08-01\t2023-04-30
NOK 670000
2022-05-01\t2022-07-31
NOK 595000
2021-08-09\t2022-04-30
NOK 555000`;

function kroner(value) {
  if (value === null || value === undefined) return "Ingen data";
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(value);
}

function percent(value) {
  if (value === null || value === undefined) return "første år";
  const sign = value > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 }).format(value)} %`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Ukjent feil");
  return payload;
}

function App() {
  const [summary, setSummary] = useState(null);
  const [entries, setEntries] = useState([]);
  const [flags, setFlags] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [salaryForm, setSalaryForm] = useState({
    id: null,
    valid_from: "",
    valid_to: "",
    amount_nok: "",
  });
  const [flagForm, setFlagForm] = useState({
    id: null,
    salary_year: new Date().getFullYear(),
    label: "",
    note: "",
    color: FLAG_COLORS[0],
  });
  const [pasteText, setPasteText] = useState(sampleText);

  async function refresh() {
    const [nextSummary, nextEntries, nextFlags] = await Promise.all([
      api("/api/summary"),
      api("/api/salary-entries"),
      api("/api/year-flags"),
    ]);
    setSummary(nextSummary);
    setEntries(nextEntries);
    setFlags(nextFlags);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []);

  async function run(action, successMessage) {
    setError("");
    setMessage("");
    try {
      await action();
      await refresh();
      setMessage(successMessage);
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveSalary(event) {
    event.preventDefault();
    await run(async () => {
      const payload = {
        valid_from: salaryForm.valid_from,
        valid_to: salaryForm.valid_to || null,
        amount_nok: Number(salaryForm.amount_nok),
      };
      if (salaryForm.id) {
        await api(`/api/salary-entries/${salaryForm.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await api("/api/salary-entries", { method: "POST", body: JSON.stringify(payload) });
      }
      setSalaryForm({ id: null, valid_from: "", valid_to: "", amount_nok: "" });
    }, "Lønnsrad lagret.");
  }

  async function importText(event) {
    event.preventDefault();
    await run(async () => {
      const result = await api("/api/import-salary-text", {
        method: "POST",
        body: JSON.stringify({ text: pasteText }),
      });
      setMessage(`Importerte ${result.imported} rader.`);
    }, "Import fullført.");
  }

  async function saveFlag(event) {
    event.preventDefault();
    await run(async () => {
      const payload = {
        salary_year: Number(flagForm.salary_year),
        label: flagForm.label,
        note: flagForm.note || null,
        color: flagForm.color,
      };
      if (flagForm.id) {
        await api(`/api/year-flags/${flagForm.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await api("/api/year-flags", { method: "POST", body: JSON.stringify(payload) });
      }
      setFlagForm({ id: null, salary_year: new Date().getFullYear(), label: "", note: "", color: FLAG_COLORS[0] });
    }, "Flagg lagret.");
  }

  async function deleteSalary(id) {
    await run(async () => api(`/api/salary-entries/${id}`, { method: "DELETE" }), "Lønnsrad slettet.");
  }

  async function deleteFlag(id) {
    await run(async () => api(`/api/year-flags/${id}`, { method: "DELETE" }), "Flagg slettet.");
  }

  async function updateStartMonth(value) {
    await run(
      async () =>
        api("/api/settings/salary-year-start-month", {
          method: "PUT",
          body: JSON.stringify({ value: Number(value) }),
        }),
      "Lønnsår oppdatert.",
    );
  }

  const currentSalary = summary?.yearly?.at(-1)?.final_amount_nok;
  const totalGrowth =
    summary?.yearly?.length > 1
      ? ((summary.yearly.at(-1).final_amount_nok - summary.yearly[0].final_amount_nok) /
          summary.yearly[0].final_amount_nok) *
        100
      : null;

  return (
    <main>
      <section className="hero">
        <div>
          <p className="eyebrow">Lokal lønnslogg</p>
          <h1>Lønnsutvikling over tid</h1>
          <p>
            Legg inn lønn manuelt eller lim inn historikk fra HR-systemet. Appen grupperer etter lønnsår,
            viser lønnstrinn, prosentendring og hendelsesflagg.
          </p>
        </div>
        <div className="hero-card">
          <span>Nåværende årslønn</span>
          <strong>{kroner(currentSalary)}</strong>
          <small>Total utvikling: {percent(totalGrowth)}</small>
        </div>
      </section>

      <Status error={error} message={message} />

      <section className="grid top-grid">
        <Panel title="Innstillinger" subtitle="Lønnsåret starter på første dag i valgt måned.">
          <label>
            Ny lønn gjelder fra
            <select
              value={summary?.salary_year_start_month || 5}
              onChange={(event) => updateStartMonth(event.target.value)}
            >
              {MONTHS.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </select>
          </label>
        </Panel>

        <Panel title="Lim inn lønnshistorikk" subtitle="Eksisterende rader med samme startdato oppdateres.">
          <form onSubmit={importText} className="stack">
            <textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} rows={12} />
            <button type="submit">Importer tekst</button>
          </form>
        </Panel>
      </section>

      <section className="grid">
        <Panel title={salaryForm.id ? "Rediger lønnsrad" : "Legg til lønnsrad"} subtitle="Årslønn er heltidsbeløp i NOK.">
          <form onSubmit={saveSalary} className="form-grid">
            <label>
              Gyldig fra
              <input
                required
                type="date"
                value={salaryForm.valid_from}
                onChange={(event) => setSalaryForm({ ...salaryForm, valid_from: event.target.value })}
              />
            </label>
            <label>
              Gyldig til
              <input
                type="date"
                value={salaryForm.valid_to || ""}
                onChange={(event) => setSalaryForm({ ...salaryForm, valid_to: event.target.value })}
              />
            </label>
            <label>
              Årslønn
              <input
                required
                inputMode="numeric"
                value={salaryForm.amount_nok}
                onChange={(event) => setSalaryForm({ ...salaryForm, amount_nok: event.target.value })}
                placeholder="860000"
              />
            </label>
            <div className="button-row">
              <button type="submit">{salaryForm.id ? "Lagre endring" : "Legg til"}</button>
              {salaryForm.id && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setSalaryForm({ id: null, valid_from: "", valid_to: "", amount_nok: "" })}
                >
                  Avbryt
                </button>
              )}
            </div>
          </form>
        </Panel>

        <Panel title={flagForm.id ? "Rediger flagg" : "Legg til flagg"} subtitle="Flagg knyttes til lønnsår.">
          <form onSubmit={saveFlag} className="form-grid">
            <label>
              Lønnsår
              <input
                required
                type="number"
                value={flagForm.salary_year}
                onChange={(event) => setFlagForm({ ...flagForm, salary_year: event.target.value })}
              />
            </label>
            <label>
              Etikett
              <input
                required
                value={flagForm.label}
                onChange={(event) => setFlagForm({ ...flagForm, label: event.target.value })}
                placeholder="Forfremmelse"
              />
            </label>
            <label>
              Notat
              <input
                value={flagForm.note || ""}
                onChange={(event) => setFlagForm({ ...flagForm, note: event.target.value })}
                placeholder="Valgfritt"
              />
            </label>
            <div className="color-row">
              {FLAG_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={flagForm.color === color ? "color active" : "color"}
                  style={{ background: color }}
                  aria-label={`Velg farge ${color}`}
                  onClick={() => setFlagForm({ ...flagForm, color })}
                />
              ))}
            </div>
            <div className="button-row">
              <button type="submit">{flagForm.id ? "Lagre flagg" : "Legg til flagg"}</button>
              {flagForm.id && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setFlagForm({
                      id: null,
                      salary_year: new Date().getFullYear(),
                      label: "",
                      note: "",
                      color: FLAG_COLORS[0],
                    })
                  }
                >
                  Avbryt
                </button>
              )}
            </div>
          </form>
        </Panel>
      </section>

      <section className="chart-grid">
        <Panel title="Årslønn per lønnsår" subtitle="Siste lønnstrinn i hvert lønnsår.">
          <SalaryBarChart yearly={summary?.yearly || []} />
        </Panel>
        <Panel title="Prosentendring" subtitle="Endring fra forrige lønnsårs sluttlønn.">
          <ChangeChart yearly={summary?.yearly || []} />
        </Panel>
      </section>

      <Panel title="Lønnstrinn" subtitle="Alle registrerte endringer, inkludert økninger inne i samme lønnsår.">
        <StepChart steps={summary?.steps || []} />
      </Panel>

      <section className="year-grid">
        {(summary?.yearly || []).map((year) => (
          <article key={year.salary_year} className="year-card">
            <div>
              <span>Lønnsår {year.salary_year}</span>
              <strong>{kroner(year.final_amount_nok)}</strong>
            </div>
            <p>{percent(year.change_percent)} fra forrige lønnsår</p>
            <div className="chips">
              {year.flags.map((flag) => (
                <span key={flag.id} className="chip" style={{ "--chip-color": flag.color }}>
                  {flag.label}
                </span>
              ))}
            </div>
          </article>
        ))}
      </section>

      <section className="grid tables">
        <Panel title="Registrerte lønnsrader">
          <DataTable
            rows={entries}
            columns={[
              ["valid_from", "Gyldig fra"],
              ["valid_to", "Gyldig til"],
              ["amount_nok", "Årslønn"],
            ]}
            formatters={{ amount_nok: kroner, valid_to: (value) => value || "Løpende" }}
            onEdit={(row) => setSalaryForm(row)}
            onDelete={(row) => deleteSalary(row.id)}
          />
        </Panel>
        <Panel title="Registrerte flagg">
          <DataTable
            rows={flags}
            columns={[
              ["salary_year", "Lønnsår"],
              ["label", "Etikett"],
              ["note", "Notat"],
            ]}
            formatters={{ note: (value) => value || "—" }}
            onEdit={(row) => setFlagForm(row)}
            onDelete={(row) => deleteFlag(row.id)}
          />
        </Panel>
      </section>
    </main>
  );
}

function Status({ error, message }) {
  if (!error && !message) return null;
  return <div className={error ? "status error" : "status"}>{error || message}</div>;
}

function Panel({ title, subtitle, children }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function SalaryBarChart({ yearly }) {
  if (!yearly.length) return <EmptyChart />;
  const values = yearly.map((item) => item.final_amount_nok);
  const max = Math.max(...values);
  return (
    <div className="bars">
      {yearly.map((item) => (
        <div key={item.salary_year} className="bar-column">
          <div className="bar-value">{kroner(item.final_amount_nok)}</div>
          <div className="bar-track">
            <div className="bar" style={{ height: `${Math.max((item.final_amount_nok / max) * 100, 8)}%` }} />
          </div>
          <span>{item.salary_year}</span>
        </div>
      ))}
    </div>
  );
}

function ChangeChart({ yearly }) {
  const data = yearly.filter((item) => item.change_percent !== null && item.change_percent !== undefined);
  if (!data.length) return <EmptyChart />;
  const maxAbs = Math.max(...data.map((item) => Math.abs(item.change_percent)), 1);
  return (
    <div className="change-chart">
      {data.map((item) => (
        <div key={item.salary_year} className="change-row">
          <span>{item.salary_year}</span>
          <div className="change-track">
            <div className="change-fill" style={{ width: `${(Math.abs(item.change_percent) / maxAbs) * 100}%` }} />
          </div>
          <strong>{percent(item.change_percent)}</strong>
        </div>
      ))}
    </div>
  );
}

function StepChart({ steps }) {
  if (!steps.length) return <EmptyChart />;
  const width = 900;
  const height = 260;
  const padding = 42;
  const amounts = steps.map((step) => step.amount_nok);
  const min = Math.min(...amounts) * 0.96;
  const max = Math.max(...amounts) * 1.04;
  const points = steps.map((step, index) => {
    const x = padding + (index / Math.max(steps.length - 1, 1)) * (width - padding * 2);
    const y = height - padding - ((step.amount_nok - min) / (max - min || 1)) * (height - padding * 2);
    return { ...step, x, y };
  });
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

  return (
    <div className="svg-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Lønnstrinn over tid">
        <path className="line-area" d={`${path} L ${points.at(-1).x} ${height - padding} L ${points[0].x} ${height - padding} Z`} />
        <path className="line" d={path} />
        {points.map((point) => (
          <g key={point.id}>
            <circle cx={point.x} cy={point.y} r="6" />
            <text x={point.x} y={point.y - 14} textAnchor="middle">
              {new Intl.NumberFormat("nb-NO", { notation: "compact" }).format(point.amount_nok)}
            </text>
            <text x={point.x} y={height - 14} textAnchor="middle" className="axis-label">
              {point.salary_year}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function EmptyChart() {
  return <div className="empty">Legg inn eller importer lønnsdata for å se grafen.</div>;
}

function DataTable({ rows, columns, formatters = {}, onEdit, onDelete }) {
  if (!rows.length) return <p className="muted">Ingen rader ennå.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map(([, label]) => (
              <th key={label}>{label}</th>
            ))}
            <th>Handling</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map(([key]) => (
                <td key={key}>{formatters[key] ? formatters[key](row[key]) : row[key]}</td>
              ))}
              <td>
                <div className="table-actions">
                  <button className="secondary small" type="button" onClick={() => onEdit(row)}>
                    Rediger
                  </button>
                  <button className="danger small" type="button" onClick={() => onDelete(row)}>
                    Slett
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
