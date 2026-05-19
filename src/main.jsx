import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { dataService, isDemoMode } from "./dataService.js";
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
const IMPORT_FORMAT_EXAMPLE = `2026-05-01
NOK 456000

2025-05-01 2026-04-30
432000`;

function kroner(value) {
  if (value === null || value === undefined) return "Ingen data";
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(value);
}

function percent(value, fallback = "første år") {
  if (value === null || value === undefined) return fallback;
  const sign = value > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 }).format(value)} %`;
}

function compactKroner(value) {
  if (value === null || value === undefined) return "første år";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const formatted = new Intl.NumberFormat("nb-NO", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Math.abs(value));
  return `${sign}${formatted} kr`;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
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
  const [pasteText, setPasteText] = useState("");

  async function refresh() {
    const [nextSummary, nextEntries, nextFlags] = await Promise.all([
      dataService.getSummary(),
      dataService.getSalaryEntries(),
      dataService.getYearFlags(),
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
      setMessage(typeof successMessage === "function" ? successMessage() : successMessage);
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
      await dataService.saveSalaryEntry(salaryForm.id, payload);
      setSalaryForm({ id: null, valid_from: "", valid_to: "", amount_nok: "" });
    }, "Lønnsrad lagret.");
  }

  async function importText(event) {
    event.preventDefault();
    let imported = 0;
    await run(async () => {
      const result = await dataService.importSalaryText(pasteText);
      imported = result.imported;
    }, () => `Importerte ${imported} rader.`);
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
      await dataService.saveYearFlag(flagForm.id, payload);
      setFlagForm({ id: null, salary_year: new Date().getFullYear(), label: "", note: "", color: FLAG_COLORS[0] });
    }, "Flagg lagret.");
  }

  async function deleteSalary(id) {
    await run(async () => dataService.deleteSalaryEntry(id), "Lønnsrad slettet.");
  }

  async function deleteFlag(id) {
    await run(async () => dataService.deleteYearFlag(id), "Flagg slettet.");
  }

  async function updateStartMonth(value) {
    await run(async () => dataService.updateStartMonth(value), "Lønnsår oppdatert.");
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
            viser lønnstrinn, prosentendring, inflasjon, reallønnsvekst og hendelsesflagg.
          </p>
        </div>
        <div className="hero-card">
          <span>Nåværende årslønn</span>
          <strong>{kroner(currentSalary)}</strong>
          <small>Total utvikling: {percent(totalGrowth)}</small>
        </div>
      </section>

      {isDemoMode && (
        <section className="demo-notice">
          <strong>Statisk demo</strong>
          <span>
            Endringer lagres bare i denne nettleseren. Bruk Docker-versjonen hvis du vil ha lokal SQLite-lagring på egen maskin.
          </span>
        </section>
      )}

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
            <div className="import-format">
              <p>Forventet format per lønnsrad:</p>
              <ul>
                <li>første linje: <code>YYYY-MM-DD</code> eller <code>YYYY-MM-DD YYYY-MM-DD</code></li>
                <li>neste linje: årslønn som heltall, valgfritt med <code>NOK</code></li>
                <li>annen tekst som overskrifter og tomme linjer ignoreres</li>
              </ul>
              <pre>{IMPORT_FORMAT_EXAMPLE}</pre>
            </div>
            <textarea
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              rows={12}
              placeholder={"2026-05-01\nNOK 456000\n\n2025-05-01 2026-04-30\n432000"}
            />
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
                placeholder="456000"
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
        <StepChart steps={summary?.steps || []} yearly={summary?.yearly || []} />
      </Panel>

      <Panel
        title="Prosentutvikling"
        subtitle="Nominell lønnsvekst, SSB KPI-inflasjon og reallønnsvekst per lønnsår."
      >
        <PercentTrendChart yearly={summary?.yearly || []} />
      </Panel>

      <Panel title="Prognose" subtitle="Forventet lønnsutvikling basert på gjennomsnittlig historisk prosentøkning.">
        <ForecastChart yearly={summary?.yearly || []} predictions={summary?.predictions} />
      </Panel>

      <section className="year-grid">
        {(summary?.yearly || []).map((year) => (
          <article key={year.salary_year} className="year-card">
            <div>
              <span>Lønnsår {year.salary_year}</span>
              <strong>{kroner(year.final_amount_nok)}</strong>
            </div>
            <div className="year-metrics">
              <Metric label="Lønnsvekst" value={percent(year.change_percent)} />
              <Metric label="Inflasjon" value={percent(year.inflation_percent, "mangler")} title={year.inflation_period} />
              <Metric label="Reallønnsvekst" value={percent(year.real_change_percent, "mangler")} />
            </div>
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

function Metric({ label, value, title }) {
  return (
    <p className="metric" title={title || undefined}>
      <span>{label}</span>
      <strong>{value}</strong>
    </p>
  );
}

function compactNumber(value) {
  if (value === null || value === undefined) return "";
  return new Intl.NumberFormat("nb-NO", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function ChartTooltip({ active, label, payload, rows, title }) {
  if (!active || !payload?.length) return null;
  const item = payload.find((entry) => entry?.payload)?.payload;
  if (!item) return null;
  const heading = title ? title(item, payload, label) : label;
  const tooltipRows = rows(item, payload).filter((row) => row.value !== null && row.value !== undefined);

  return (
    <div className="chart-tooltip">
      <strong>{heading}</strong>
      {tooltipRows.map((row, index) => (
        <p key={`${row.label}-${index}`}>
          <span>{row.label}</span>
          <b>{row.value}</b>
        </p>
      ))}
    </div>
  );
}

function ChartFrame({ children, className = "", style }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    function updateReady() {
      const box = node.getBoundingClientRect();
      setReady(box.width > 0 && box.height > 0);
    }

    updateReady();
    if (!window.ResizeObserver) return undefined;
    const observer = new ResizeObserver(updateReady);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`chart-frame ${className}`.trim()} style={style}>
      {ready ? children : null}
    </div>
  );
}

function FlagReferenceLines({ flags, data, xKey }) {
  return chartFlags(flags)
    .map((flag) => {
      const point = data.find((item) => item.salary_year === flag.salary_year);
      if (!point) return null;
      return (
        <ReferenceLine
          key={flag.id}
          x={point[xKey]}
          stroke={flag.color}
          strokeDasharray="5 6"
          strokeOpacity={0.72}
          label={{ value: flag.label, position: "insideTop", fill: flag.color, fontSize: 12, fontWeight: 800 }}
        />
      );
    })
    .filter(Boolean);
}

function SalaryBarChart({ yearly }) {
  if (!yearly.length) return <EmptyChart />;
  const data = yearly.map((item) => ({
    ...item,
    year_label: String(item.salary_year),
  }));

  return (
    <ChartFrame>
      <ResponsiveContainer width="100%" height="100%" minWidth={240} minHeight={240} initialDimension={{ width: 240, height: 240 }}>
        <BarChart data={data} margin={{ top: 8, right: 18, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="year_label" interval="preserveStartEnd" tickLine={false} />
          <YAxis tickFormatter={compactNumber} tickLine={false} width={58} />
          <Tooltip
            content={
              <ChartTooltip
                rows={(item) => [
                  { label: "Årslønn", value: kroner(item.final_amount_nok) },
                  { label: "Lønnsår", value: item.salary_year },
                ]}
              />
            }
          />
          <Bar dataKey="final_amount_nok" name="Årslønn" fill="#0f766e" radius={[8, 8, 0, 0]} maxBarSize={58} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function ChangeChart({ yearly }) {
  const data = yearly
    .filter((item) => item.change_percent !== null && item.change_percent !== undefined)
    .map((item) => ({ ...item, year_label: String(item.salary_year) }));
  if (!data.length) return <EmptyChart />;

  return (
    <ChartFrame className="compact" style={{ "--chart-height": `${Math.max(240, data.length * 48)}px` }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={240} minHeight={220} initialDimension={{ width: 240, height: 220 }}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 26, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 5" horizontal={false} />
          <XAxis
            type="number"
            domain={[(dataMin) => Math.min(0, dataMin), (dataMax) => Math.max(0, dataMax)]}
            tickFormatter={(value) => `${value}%`}
            tickLine={false}
          />
          <YAxis type="category" dataKey="year_label" tickLine={false} width={52} />
          <ReferenceLine x={0} stroke="rgba(23, 32, 25, 0.32)" />
          <Tooltip
            content={
              <ChartTooltip
                rows={(item) => [
                  { label: "Lønnsvekst", value: percent(item.change_percent) },
                  { label: "Økning", value: compactKroner(item.change_nok) },
                  { label: "Sluttlønn", value: kroner(item.final_amount_nok) },
                ]}
              />
            }
          />
          <Bar dataKey="change_percent" name="Prosentendring" fill="#b45309" radius={[0, 8, 8, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function chartFlags(yearly) {
  return yearly.flatMap((year) =>
    year.flags.map((flag) => ({
      ...flag,
      salary_year: year.salary_year,
    })),
  );
}

function StepChart({ steps, yearly }) {
  if (!steps.length) return <EmptyChart />;
  const data = steps.map((step, index) => ({
    ...step,
    step_label: `${step.salary_year}-${index}`,
    display_label: `${step.salary_year} · ${step.valid_from.slice(5)}`,
  }));

  return (
    <ChartFrame className="wide">
      <ResponsiveContainer width="100%" height="100%" minWidth={240} minHeight={260} initialDimension={{ width: 240, height: 260 }}>
        <LineChart data={data} margin={{ top: 18, right: 26, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="step_label" tickFormatter={(_, index) => data[index]?.display_label || ""} interval="preserveStartEnd" tickLine={false} />
          <YAxis
            tickFormatter={compactNumber}
            tickLine={false}
            width={58}
            domain={[(dataMin) => Math.floor(dataMin * 0.96), (dataMax) => Math.ceil(dataMax * 1.04)]}
          />
          <Tooltip
            content={
              <ChartTooltip
                title={(item) => item.display_label}
                rows={(item) => [
                  { label: "Årslønn", value: kroner(item.amount_nok) },
                  { label: "Lønnsår", value: item.salary_year },
                  { label: "Gyldig fra", value: item.valid_from },
                  { label: "Gyldig til", value: item.valid_to || "Løpende" },
                ]}
              />
            }
          />
          <Legend />
          <FlagReferenceLines flags={yearly} data={data} xKey="step_label" />
          <Line type="monotone" dataKey="amount_nok" name="Årslønn" stroke="#0f766e" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 7 }} />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function PercentTrendChart({ yearly }) {
  const [mode, setMode] = useState("percent");
  const metricConfig = {
    percent: {
      label: "Lønnsvekst",
      value: (year) => year.change_percent,
      format: percent,
      ariaLabel: "Nominell prosentvis lønnsutvikling per lønnsår",
      color: "#b45309",
      fill: "rgba(180, 83, 9, 0.14)",
    },
    real: {
      label: "Reallønn",
      value: (year) => year.real_change_percent,
      format: (value) => percent(value, "mangler"),
      ariaLabel: "Reallønnsvekst per lønnsår etter inflasjon",
      color: "#0f766e",
      fill: "rgba(15, 118, 110, 0.14)",
    },
    inflation: {
      label: "Inflasjon",
      value: (year) => year.inflation_percent,
      format: (value) => percent(value, "mangler"),
      ariaLabel: "Inflasjon per lønnsår basert på SSB KPI",
      color: "#2563eb",
      fill: "rgba(37, 99, 235, 0.13)",
    },
    money: {
      label: "Kroner",
      value: (year) => year.change_nok,
      format: compactKroner,
      ariaLabel: "Lønnsøkning i kroner per lønnsår",
      color: "#b45309",
      fill: "rgba(180, 83, 9, 0.14)",
    },
  };
  const config = metricConfig[mode];
  const data = yearly
    .filter((year) => {
      const value = config.value(year);
      return value !== null && value !== undefined;
    })
    .map((year) => ({
      ...year,
      year_label: String(year.salary_year),
      metric_value: config.value(year),
    }));
  if (!data.length) return <EmptyChart />;

  const values = data.map((year) => year.metric_value);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const medianValue = median(values);
  const formatValue = config.format;

  return (
    <div className="chart-card" aria-label={config.ariaLabel}>
      <div className="chart-toolbar">
        <div className="chart-toggle" aria-label="Velg visning">
          <button className={mode === "percent" ? "active" : ""} type="button" onClick={() => setMode("percent")}>
            Lønnsvekst
          </button>
          <button className={mode === "real" ? "active" : ""} type="button" onClick={() => setMode("real")}>
            Reallønn
          </button>
          <button className={mode === "inflation" ? "active" : ""} type="button" onClick={() => setMode("inflation")}>
            Inflasjon
          </button>
          <button className={mode === "money" ? "active" : ""} type="button" onClick={() => setMode("money")}>
            Kroner
          </button>
        </div>
        <div className="chart-summary">
          <span>Viser</span>
          <strong>{config.label}</strong>
          <span>Snitt</span>
          <strong>{formatValue(average)}</strong>
          <span>Median</span>
          <strong>{formatValue(medianValue)}</strong>
        </div>
      </div>
      <p className="chart-note">
        Inflasjon følger valgt lønnsår og bruker SSB KPI totalindeks fra startmåned til samme måned året etter.
      </p>
      <ChartFrame className="wide">
        <ResponsiveContainer width="100%" height="100%" minWidth={240} minHeight={260} initialDimension={{ width: 240, height: 260 }}>
          <ComposedChart data={data} margin={{ top: 18, right: 28, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 5" vertical={false} />
            <XAxis dataKey="year_label" interval="preserveStartEnd" tickLine={false} />
            <YAxis tickFormatter={mode === "money" ? compactNumber : (value) => `${value}%`} tickLine={false} width={58} />
            <Tooltip
              content={
                <ChartTooltip
                  rows={(item) => [
                    { label: config.label, value: formatValue(item.metric_value) },
                    { label: "Økning", value: compactKroner(item.change_nok) },
                    { label: "Lønnsvekst", value: percent(item.change_percent) },
                    { label: "Inflasjon", value: percent(item.inflation_percent, "mangler") },
                    { label: "Reallønnsvekst", value: percent(item.real_change_percent, "mangler") },
                    { label: "Inflasjonsperiode", value: item.inflation_period || "mangler" },
                    { label: "Sluttlønn", value: kroner(item.final_amount_nok) },
                    { label: "Antall lønnstrinn", value: item.steps.length },
                  ]}
                />
              }
            />
            <Legend />
            <ReferenceLine y={0} stroke="rgba(23, 32, 25, 0.22)" strokeDasharray="6 6" />
            <ReferenceLine y={average} stroke="#0f766e" strokeDasharray="4 7" label={{ value: `Snitt ${formatValue(average)}`, position: "right", fill: "#0f766e", fontSize: 12 }} />
            <ReferenceLine y={medianValue} stroke="#b45309" strokeDasharray="8 7" label={{ value: `Median ${formatValue(medianValue)}`, position: "right", fill: "#b45309", fontSize: 12 }} />
            <FlagReferenceLines flags={yearly} data={data} xKey="year_label" />
            <Area type="monotone" dataKey="metric_value" name={config.label} stroke="none" fill={config.fill} legendType="none" />
            <Line type="monotone" dataKey="metric_value" name={config.label} stroke={config.color} strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 7 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}

function ForecastChart({ yearly, predictions }) {
  const predictedItems = predictions?.items || [];
  if (!yearly.length || !predictedItems.length) return <EmptyChart />;

  const actualPoints = yearly.map((year) => ({
    salary_year: year.salary_year,
    year_label: String(year.salary_year),
    actual_amount: year.final_amount_nok,
    forecast_amount: null,
    amount_nok: year.final_amount_nok,
    kind_label: "Historikk",
  }));
  actualPoints[actualPoints.length - 1].forecast_amount = actualPoints.at(-1).actual_amount;
  const forecastPoints = predictedItems.map((item) => ({
    salary_year: item.salary_year,
    year_label: String(item.salary_year),
    actual_amount: null,
    forecast_amount: item.predicted_amount_nok,
    amount_nok: item.predicted_amount_nok,
    kind_label: "Prognose",
  }));
  const data = [...actualPoints, ...forecastPoints];

  return (
    <div className="chart-card">
      <div className="chart-summary forecast-summary">
        <span>Basert på {predictions.based_on_years} lønnsår</span>
        <strong>{percent(predictions.average_change_percent)}</strong>
        <small>snittvekst brukt fremover</small>
      </div>
      <ChartFrame className="forecast">
        <ResponsiveContainer width="100%" height="100%" minWidth={240} minHeight={260} initialDimension={{ width: 240, height: 260 }}>
          <ComposedChart data={data} margin={{ top: 18, right: 28, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 5" vertical={false} />
            <XAxis dataKey="year_label" interval="preserveStartEnd" tickLine={false} />
            <YAxis
              tickFormatter={compactNumber}
              tickLine={false}
              width={58}
              domain={[(dataMin) => Math.floor(dataMin * 0.96), (dataMax) => Math.ceil(dataMax * 1.04)]}
            />
            <Tooltip
              content={
                <ChartTooltip
                  rows={(item) => [
                    { label: "Type", value: item.kind_label },
                    { label: "Årslønn", value: kroner(item.amount_nok) },
                    {
                      label: "Metode",
                      value: item.forecast_amount ? `Snittvekst ${percent(predictions.average_change_percent)}` : null,
                    },
                  ]}
                />
              }
            />
            <Legend />
            <Area type="monotone" dataKey="forecast_amount" name="Prognoseområde" stroke="none" fill="rgba(180, 83, 9, 0.12)" connectNulls legendType="none" />
            <Line type="monotone" dataKey="actual_amount" name="Historikk" stroke="#0f766e" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 7 }} />
            <Line
              type="monotone"
              dataKey="forecast_amount"
              name="Prognose"
              stroke="#b45309"
              strokeWidth={3}
              strokeDasharray="8 7"
              dot={{ r: 4 }}
              activeDot={{ r: 7 }}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFrame>
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
