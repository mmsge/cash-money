import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
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
NOK 200000

2025-05-01 2026-04-30
100000`;

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
              placeholder={"2026-05-01\nNOK 200000\n\n2025-05-01 2026-04-30\n100000"}
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

function chartFlags(yearly) {
  return yearly.flatMap((year) =>
    year.flags.map((flag) => ({
      ...flag,
      salary_year: year.salary_year,
    })),
  );
}

function FlagMarkers({ flags, xByYear, top, bottom }) {
  return flags
    .filter((flag) => xByYear.has(flag.salary_year))
    .map((flag, index) => {
      const x = xByYear.get(flag.salary_year);
      const labelY = top + 15 + (index % 3) * 24;
      return (
        <g key={flag.id} className="flag-marker">
          <title>{`${flag.label} (${flag.salary_year})${flag.note ? `: ${flag.note}` : ""}`}</title>
          <line
            x1={x}
            x2={x}
            y1={top}
            y2={bottom}
            style={{ "--flag-color": flag.color }}
          />
          <text
            x={x + 8}
            y={labelY}
            className="flag-label"
            style={{ "--flag-color": flag.color }}
          >
            {flag.label}
          </text>
        </g>
      );
    });
}

function flagPositionsBetweenYears(years, xByYear) {
  const sortedYears = [...new Set(years)].sort((a, b) => a - b);
  return new Map(
    sortedYears.flatMap((year, index) => {
      const nextYear = sortedYears[index + 1];
      if (!nextYear || !xByYear.has(year) || !xByYear.has(nextYear)) return [];
      return [[year, (xByYear.get(year) + xByYear.get(nextYear)) / 2]];
    }),
  );
}

function StepChart({ steps, yearly }) {
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
  const xByYear = new Map();
  for (const year of new Set(points.map((point) => point.salary_year))) {
    const yearPoints = points.filter((point) => point.salary_year === year);
    const averageX = yearPoints.reduce((sum, point) => sum + point.x, 0) / yearPoints.length;
    xByYear.set(year, averageX);
  }
  const flagXByYear = flagPositionsBetweenYears(
    yearly.map((year) => year.salary_year),
    xByYear,
  );

  return (
    <div className="svg-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Lønnstrinn over tid">
        <path className="line-area" d={`${path} L ${points.at(-1).x} ${height - padding} L ${points[0].x} ${height - padding} Z`} />
        <FlagMarkers flags={chartFlags(yearly)} xByYear={flagXByYear} top={padding / 2} bottom={height - padding} />
        <path className="line" d={path} />
        {points.map((point) => (
          <g key={point.id}>
            <title>{`Lønnsår ${point.salary_year}
Gyldig fra: ${point.valid_from}
Årslønn: ${kroner(point.amount_nok)}${point.valid_to ? `\nGyldig til: ${point.valid_to}` : ""}`}</title>
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

function PercentTrendChart({ yearly }) {
  const [mode, setMode] = useState("percent");
  const metricConfig = {
    percent: {
      label: "Lønnsvekst",
      value: (year) => year.change_percent,
      format: percent,
      ariaLabel: "Nominell prosentvis lønnsutvikling per lønnsår",
      lineClass: "percent-line",
      dotClass: "percent-dot",
      areaClass: "percent-area",
    },
    real: {
      label: "Reallønn",
      value: (year) => year.real_change_percent,
      format: (value) => percent(value, "mangler"),
      ariaLabel: "Reallønnsvekst per lønnsår etter inflasjon",
      lineClass: "real-line",
      dotClass: "real-dot",
      areaClass: "real-area",
    },
    inflation: {
      label: "Inflasjon",
      value: (year) => year.inflation_percent,
      format: (value) => percent(value, "mangler"),
      ariaLabel: "Inflasjon per lønnsår basert på SSB KPI",
      lineClass: "inflation-line",
      dotClass: "inflation-dot",
      areaClass: "inflation-area",
    },
    money: {
      label: "Kroner",
      value: (year) => year.change_nok,
      format: compactKroner,
      ariaLabel: "Lønnsøkning i kroner per lønnsår",
      lineClass: "percent-line",
      dotClass: "percent-dot",
      areaClass: "percent-area",
    },
  };
  const config = metricConfig[mode];
  const data = yearly.filter((year) => {
    const value = config.value(year);
    return value !== null && value !== undefined;
  });
  if (!data.length) return <EmptyChart />;

  const width = 900;
  const height = 260;
  const padding = 42;
  const values = data.map((year) => config.value(year));
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const range = maxValue - minValue || 1;
  const yFor = (value) => height - padding - ((value - minValue) / range) * (height - padding * 2);
  const points = data.map((year, index) => {
    const x = padding + (index / Math.max(data.length - 1, 1)) * (width - padding * 2);
    const value = config.value(year);
    return { ...year, value, x, y: yFor(value) };
  });
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const xByYear = new Map(points.map((point) => [point.salary_year, point.x]));
  const flagXByYear = flagPositionsBetweenYears(
    yearly.map((year) => year.salary_year),
    xByYear,
  );
  const zeroY = yFor(0);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const medianValue = median(values);
  const averageY = yFor(average);
  const medianY = yFor(medianValue);
  const formatValue = config.format;

  return (
    <div className="svg-wrap percent-card">
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
      <p className="chart-note">
        Inflasjon følger valgt lønnsår og bruker SSB KPI totalindeks fra startmåned til samme måned året etter.
      </p>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={config.ariaLabel}>
        <line className="reference-line" x1={padding} x2={width - padding} y1={zeroY} y2={zeroY} />
        <line className="average-line" x1={padding} x2={width - padding} y1={averageY} y2={averageY} />
        <line className="median-line" x1={padding} x2={width - padding} y1={medianY} y2={medianY} />
        <path
          className={config.areaClass}
          d={`${path} L ${points.at(-1).x} ${height - padding} L ${points[0].x} ${height - padding} Z`}
        />
        <FlagMarkers flags={chartFlags(yearly)} xByYear={flagXByYear} top={padding / 2} bottom={height - padding} />
        <text x={width - padding} y={averageY - 8} textAnchor="end" className="reference-label">
          Snitt {formatValue(average)}
        </text>
        <text x={width - padding} y={medianY + 18} textAnchor="end" className="reference-label median-label">
          Median {formatValue(medianValue)}
        </text>
        <path className={config.lineClass} d={path} />
        {points.map((point) => (
          <g key={`${mode}-${point.salary_year}`}>
            <title>{`Lønnsår ${point.salary_year}
Økning: ${compactKroner(point.change_nok)}
Lønnsvekst: ${percent(point.change_percent)}
Inflasjon: ${percent(point.inflation_percent, "mangler")}
Reallønnsvekst: ${percent(point.real_change_percent, "mangler")}
Inflasjonsperiode: ${point.inflation_period || "mangler"}
Sluttlønn: ${kroner(point.final_amount_nok)}
Antall lønnstrinn: ${point.steps.length}`}</title>
            <circle className={config.dotClass} cx={point.x} cy={point.y} r="6" />
            <text x={point.x} y={point.y - 14} textAnchor="middle">
              {formatValue(point.value)}
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

function ForecastChart({ yearly, predictions }) {
  const predictedItems = predictions?.items || [];
  if (!yearly.length || !predictedItems.length) return <EmptyChart />;

  const width = 900;
  const height = 280;
  const padding = 42;
  const actualPoints = yearly.map((year) => ({
    salary_year: year.salary_year,
    amount_nok: year.final_amount_nok,
    kind: "actual",
  }));
  const forecastPoints = predictedItems.map((item) => ({
    salary_year: item.salary_year,
    amount_nok: item.predicted_amount_nok,
    kind: "prediction",
  }));
  const points = [...actualPoints, ...forecastPoints];
  const amounts = points.map((point) => point.amount_nok);
  const min = Math.min(...amounts) * 0.96;
  const max = Math.max(...amounts) * 1.04;
  const positioned = points.map((point, index) => {
    const x = padding + (index / Math.max(points.length - 1, 1)) * (width - padding * 2);
    const y = height - padding - ((point.amount_nok - min) / (max - min || 1)) * (height - padding * 2);
    return { ...point, x, y };
  });
  const actualPositioned = positioned.filter((point) => point.kind === "actual");
  const forecastPositioned = positioned.filter((point) => point.kind === "prediction");
  const actualPath = actualPositioned.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const connectorPath = `M ${actualPositioned.at(-1).x} ${actualPositioned.at(-1).y} ${forecastPositioned
    .map((point) => `L ${point.x} ${point.y}`)
    .join(" ")}`;
  const firstPrediction = forecastPositioned[0];
  const lastPrediction = forecastPositioned.at(-1);

  return (
    <div className="svg-wrap forecast-card">
      <div className="chart-summary forecast-summary">
        <span>Basert på {predictions.based_on_years} lønnsår</span>
        <strong>{percent(predictions.average_change_percent)}</strong>
        <small>snittvekst brukt fremover</small>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Prognose for fremtidig lønnsutvikling">
        <path
          className="forecast-area"
          d={`${connectorPath} L ${lastPrediction.x} ${height - padding} L ${firstPrediction.x} ${height - padding} Z`}
        />
        <path className="line" d={actualPath} />
        <path className="forecast-line" d={connectorPath} />
        {positioned.map((point) => (
          <g key={`${point.kind}-${point.salary_year}`}>
            <title>{`${point.kind === "prediction" ? "Prognose" : "Historikk"} ${point.salary_year}
Årslønn: ${kroner(point.amount_nok)}${
              point.kind === "prediction" ? `\nBasert på snittvekst: ${percent(predictions.average_change_percent)}` : ""
            }`}</title>
            <circle className={point.kind === "prediction" ? "forecast-dot" : ""} cx={point.x} cy={point.y} r="6" />
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
