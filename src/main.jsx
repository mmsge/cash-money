import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { dataService, isDemoMode } from "./dataService.js";
import { buildAdjustmentCalculation } from "./salaryCore.js";
import "./styles.css";

const APP_NAME = "Kæsj-månni";

const MONTHS_NN = [
  "Januar", "Februar", "Mars", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Desember",
];

const FLAG_COLORS = [
  { name: "blue", hex: "#2E4756" },
  { name: "green", hex: "#4A7C59" },
  { name: "rust", hex: "#B5651D" },
];

// ─── Formatters ───────────────────────────────────────────────────────

const NOK = (n) =>
  new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(n);

const NOK_COMPACT = (n) => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} m`;
  if (abs >= 1000) return `${(n / 1000).toFixed(0)} k`;
  return `${n}`;
};

const NUM = (n) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(n);
};

const PCT = (n, digits = 1) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(digits)} %`;
};

const SIGNED_NOK = (n) => {
  if (n === null || n === undefined) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${NOK(Math.abs(n))}`;
};

// ─── Adapter: turn summary → design-shaped data ───────────────────────

function adaptSummary(summary) {
  if (!summary) return null;
  const yearly = summary.yearly || [];
  const predictions = summary.predictions || {};
  const dashboard = summary.dashboard || {};

  if (!yearly.length) return null;

  const startYear = yearly[0].salary_year;
  const currentYear = yearly[yearly.length - 1].salary_year;
  const startSalary = yearly[0].final_amount_nok;
  const currentSalary = yearly[yearly.length - 1].final_amount_nok;

  // Compound inflation across years.
  const totalInflation = yearly
    .map((y) => y.inflation_percent)
    .filter((v) => v !== null && v !== undefined)
    .reduce((factor, v) => factor * (1 + Number(v) / 100), 1) - 1;

  const totalNominalGrowth =
    dashboard.total_nominal_growth_percent !== null && dashboard.total_nominal_growth_percent !== undefined
      ? dashboard.total_nominal_growth_percent / 100
      : (currentSalary - startSalary) / startSalary;

  const totalRealGrowth =
    dashboard.cumulative_real_growth_percent !== null && dashboard.cumulative_real_growth_percent !== undefined
      ? dashboard.cumulative_real_growth_percent / 100
      : null;

  const years = yearly.map((y) => {
    const firstFlag = (y.flags && y.flags[0]) || null;
    const flag = firstFlag
      ? {
          label: firstFlag.label,
          color: mapFlagColor(firstFlag.color),
          note: firstFlag.note || null,
        }
      : null;
    return {
      year: y.salary_year,
      final: y.final_amount_nok,
      change: y.change_percent === null || y.change_percent === undefined ? null : y.change_percent / 100,
      changeNok: y.change_nok,
      inflation: y.inflation_percent === null || y.inflation_percent === undefined ? null : y.inflation_percent / 100,
      real: y.real_change_percent === null || y.real_change_percent === undefined ? null : y.real_change_percent / 100,
      kpiMaintained: y.inflation_maintained_salary_nok,
      gap: y.annual_gap_nok,
      steps: (y.steps || []).length,
      preliminary: y.inflation_preliminary,
      flag,
    };
  });

  const avgYearlyRaise =
    predictions.average_change_percent === null || predictions.average_change_percent === undefined
      ? null
      : predictions.average_change_percent / 100;

  // Synthesize low/high range using ±2pp from predicted growth.
  const forecast = (predictions.items || []).map((item) => {
    const mid = item.predicted_amount_nok;
    const growth = predictions.average_change_percent / 100;
    const offset = 0.02;
    const stepsAhead = item.salary_year - currentYear;
    const lowFactor = Math.pow(1 + Math.max(0, growth - offset), stepsAhead);
    const highFactor = Math.pow(1 + growth + offset, stepsAhead);
    return {
      year: item.salary_year,
      mid,
      low: Math.round(currentSalary * lowFactor),
      high: Math.round(currentSalary * highFactor),
    };
  });

  return {
    currentSalary,
    startSalary,
    startYear,
    currentYear,
    totalNominalGrowth,
    totalInflation: totalInflation === 0 ? null : totalInflation,
    totalRealGrowth,
    avgYearlyRaise,
    source: yearly.find((y) => y.inflation_source)?.inflation_source || "SSB tabell 14709",
    years,
    forecast,
    steps: (summary.steps || []).map((s) => ({
      from: s.valid_from,
      to: s.valid_to || null,
      amount: s.amount_nok,
    })),
  };
}

function mapFlagColor(color) {
  // Accept design-token names directly.
  if (color === "blue" || color === "green" || color === "rust") return color;
  // Map any other hex/name to nearest of three palettes.
  const c = String(color || "").toLowerCase();
  if (c.includes("0f766e") || c.includes("4d7c0f")) return "green";
  if (c.includes("d97706") || c.includes("be123c") || c.includes("b45309")) return "rust";
  return "blue";
}

// ─── Charts ───────────────────────────────────────────────────────────

function HookLines({ data }) {
  const W = 720, H = 360;
  const pad = { l: 0, r: 80, t: 30, b: 40 };

  // Build cumulative salary % series + cumulative inflation %.
  let series;
  if (data && data.years && data.years.length > 1) {
    const start = data.startSalary;
    const salary = data.years.map((y) => (y.final - start) / start);
    let infFactor = 1;
    const inflat = data.years.map((y, i) => {
      if (i === 0) return 0;
      if (y.inflation === null || y.inflation === undefined) return null;
      infFactor *= 1 + y.inflation;
      return infFactor - 1;
    });
    series = { years: data.years.map((y) => y.year), salary, inflat };
  } else {
    const years = [2021, 2022, 2023, 2024, 2025, 2026];
    series = {
      years,
      salary: [0, 0.075, 0.125, 0.175, 0.238, 0.300],
      inflat: [0, 0.058, 0.128, 0.162, 0.191, 0.219],
    };
  }

  const maxValue = Math.max(0.06, ...series.salary, ...series.inflat.filter((v) => v !== null));
  const ymax = maxValue * 1.08;
  const xmax = series.years.length - 1;
  const X = (i) => pad.l + (i / Math.max(xmax, 1)) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - v / ymax) * (H - pad.t - pad.b);

  const buildPath = (arr) => {
    const filtered = arr.map((v, i) => [v, i]).filter(([v]) => v !== null && v !== undefined);
    return filtered.map(([v, i], idx) => `${idx === 0 ? "M" : "L"} ${X(i)} ${Y(v)}`).join(" ");
  };
  const salaryLast = series.salary[xmax];
  const inflatLastIdx = series.inflat.map((v, i) => (v === null ? null : i)).filter((v) => v !== null).pop();
  const inflatLast = inflatLastIdx !== null && inflatLastIdx !== undefined ? series.inflat[inflatLastIdx] : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Lønn versus prisar">
      <line x1={pad.l} x2={W - pad.r} y1={Y(0)} y2={Y(0)} stroke="var(--line)" />
      <path d={buildPath(series.inflat)} fill="none" stroke="var(--negative)" strokeWidth="2" strokeLinecap="round" strokeDasharray="6 7" />
      <path d={buildPath(series.salary)} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" />

      <g transform={`translate(${X(xmax) + 10}, ${Y(salaryLast)})`}>
        <circle r="3.5" fill="var(--primary)" />
        <text x="10" y="4" fontSize="13" fill="var(--primary)" fontWeight="500" letterSpacing="-0.01em">
          Løn  {PCT(salaryLast, 0)}
        </text>
      </g>
      {inflatLast !== null && (
        <g transform={`translate(${X(inflatLastIdx) + 10}, ${Y(inflatLast)})`}>
          <circle r="3.5" fill="var(--negative)" />
          <text x="10" y="4" fontSize="13" fill="var(--negative)" fontWeight="500" letterSpacing="-0.01em">
            Prisar  {PCT(inflatLast, 0)}
          </text>
        </g>
      )}

      <g fontSize="11" fill="var(--muted)" letterSpacing="0.06em">
        <text x={X(0)} y={H - 14}>{series.years[0]}</text>
        <text x={X(xmax) - 24} y={H - 14}>{series.years[xmax]}</text>
      </g>
    </svg>
  );
}

function TimelineChart({ years, steps, chartStyle = "line" }) {
  const W = 1100, H = 460;
  const pad = { l: 56, r: 28, t: 36, b: 56 };
  if (!steps.length) return null;
  const min = Math.min(...steps.map((s) => s.amount)) * 0.93;
  const max = Math.max(...steps.map((s) => s.amount)) * 1.04;
  const xmax = Math.max(steps.length - 1, 1);
  const X = (i) => pad.l + (i / xmax) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);

  const linePath = steps.map((s, i) => `${i === 0 ? "M" : "L"} ${X(i)} ${Y(s.amount)}`).join(" ");
  const areaPath = linePath + ` L ${X(xmax)} ${H - pad.b} L ${X(0)} ${H - pad.b} Z`;

  const yearTicks = years.map((y, idx) => {
    let stepIdx;
    if (y.year === years[0].year) stepIdx = 0;
    else {
      const found = steps.findIndex((s) => s.from.startsWith(`${y.year}-`));
      stepIdx = found === -1 ? idx : found;
    }
    return { year: y.year, x: X(stepIdx), flag: y.flag };
  });

  const yTicks = [min, min + (max - min) * 0.33, min + (max - min) * 0.66, max].map(
    (v) => Math.round(v / 10000) * 10000,
  );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Lønsutvikling over tid">
      <defs>
        <linearGradient id="tl-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {yTicks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={Y(v)} y2={Y(v)} stroke="var(--line-soft)" />
          <text x={pad.l - 10} y={Y(v) + 4} fontSize="11" fill="var(--muted)" textAnchor="end"
            style={{ fontVariantNumeric: "tabular-nums" }}>
            {NOK_COMPACT(v)} kr
          </text>
        </g>
      ))}

      <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--line)" />

      {chartStyle === "area" && <path d={areaPath} fill="url(#tl-fill)" />}
      {chartStyle === "bars" && (
        <g>
          {steps.map((s, i) => {
            const w = Math.max(18, (W - pad.l - pad.r) / steps.length - 14);
            return (
              <rect
                key={i}
                x={X(i) - w / 2}
                y={Y(s.amount)}
                width={w}
                height={Math.max(0, H - pad.b - Y(s.amount))}
                fill="var(--primary)"
                opacity={0.78}
                rx="1"
              />
            );
          })}
        </g>
      )}
      {chartStyle !== "bars" && (
        <path d={linePath} fill="none" stroke="var(--primary)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      )}

      {chartStyle !== "bars" && steps.map((s, i) => (
        <circle
          key={i}
          cx={X(i)}
          cy={Y(s.amount)}
          r={i === steps.length - 1 ? 4.5 : 3}
          fill={i === steps.length - 1 ? "var(--primary)" : "var(--bg)"}
          stroke="var(--primary)"
          strokeWidth="1.6"
        />
      ))}

      {yearTicks.map((t) => (
        <g key={t.year}>
          <line x1={t.x} x2={t.x} y1={H - pad.b} y2={H - pad.b + 4} stroke="var(--line)" />
          <text x={t.x} y={H - pad.b + 22} fontSize="11" fill="var(--muted)" textAnchor="middle" letterSpacing="0.05em">
            {t.year}
          </text>
          {t.flag && (
            <g transform={`translate(${t.x}, ${pad.t - 6})`}>
              <line
                x1="0" x2="0" y1="6" y2={H - pad.b - pad.t + 6}
                stroke={`var(--${t.flag.color === "blue" ? "primary" : t.flag.color === "rust" ? "negative" : "positive"})`}
                strokeWidth="1"
                strokeDasharray="3 4"
                opacity="0.55"
              />
              <text
                x="6" y="2" fontSize="10.5"
                fill={`var(--${t.flag.color === "blue" ? "primary" : t.flag.color === "rust" ? "negative" : "positive"})`}
                fontWeight="500"
                letterSpacing="0.04em"
              >
                {t.flag.label}
              </text>
            </g>
          )}
        </g>
      ))}

      <g transform={`translate(${X(steps.length - 1) + 12}, ${Y(steps[steps.length - 1].amount)})`}>
        <text x="0" y="-12" fontSize="11" letterSpacing="0.12em" fill="var(--muted)" style={{ textTransform: "uppercase" }}>
          No
        </text>
        <text x="0" y="6" fontSize="15" fontWeight="500" fill="var(--ink)" style={{ fontVariantNumeric: "tabular-nums" }}>
          {NUM(steps[steps.length - 1].amount)} kr
        </text>
      </g>
    </svg>
  );
}

function CompareChart({ years }) {
  const W = 1100, H = 460;
  const pad = { l: 56, r: 28, t: 30, b: 56 };

  const data = years.filter((y) => y.change !== null && y.inflation !== null && y.real !== null);
  if (!data.length) return null;
  const max = Math.max(...data.flatMap((d) => [d.change, d.inflation]), 0.08) * 1.15;
  const min = Math.min(...data.flatMap((d) => [d.real, 0])) * 1.25;
  const X = (i) => pad.l + (i / (data.length - 1 + 0.001)) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const barW = Math.min(38, (W - pad.l - pad.r) / data.length / 2.6);

  const yTicks = [-0.02, 0, 0.04, 0.08].filter((v) => v >= min && v <= max);
  const realPath = data.map((d, i) => `${i === 0 ? "M" : "L"} ${X(i)} ${Y(d.real)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Lønn versus inflasjon">
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={Y(v)} y2={Y(v)} stroke={v === 0 ? "var(--line)" : "var(--line-soft)"} />
          <text x={pad.l - 10} y={Y(v) + 4} fontSize="11" fill="var(--muted)" textAnchor="end" style={{ fontVariantNumeric: "tabular-nums" }}>
            {`${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)} %`}
          </text>
        </g>
      ))}

      {data.map((d, i) => {
        const cx = X(i);
        return (
          <g key={d.year}>
            <rect x={cx - barW - 3} y={Y(Math.max(d.change, 0))} width={barW} height={Math.abs(Y(d.change) - Y(0))} fill="var(--primary)" opacity="0.92" rx="1" />
            <rect x={cx + 3} y={Y(Math.max(d.inflation, 0))} width={barW} height={Math.abs(Y(d.inflation) - Y(0))} fill="var(--negative)" opacity="0.78" rx="1" />
            <text x={cx} y={H - pad.b + 22} fontSize="11" fill="var(--muted)" textAnchor="middle" letterSpacing="0.04em">
              {d.year}
            </text>
          </g>
        );
      })}

      <path d={realPath} fill="none" stroke="var(--positive)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {data.map((d, i) => (
        <circle key={d.year} cx={X(i)} cy={Y(d.real)} r="3.5" fill="var(--bg)" stroke="var(--positive)" strokeWidth="1.6" />
      ))}

      {data
        .filter((d) => d.real < 0)
        .map((d) => {
          const i = data.findIndex((x) => x.year === d.year);
          return (
            <g key={`u-${d.year}`} transform={`translate(${X(i)}, ${Y(d.real)})`}>
              <text x="12" y="18" fontSize="11" fill="var(--negative)" fontWeight="500">under inflasjon</text>
            </g>
          );
        })}
    </svg>
  );
}

function GapChart({ years }) {
  const W = 1100, H = 460;
  const pad = { l: 60, r: 64, t: 36, b: 56 };
  const data = years.filter((d) => d.final !== null && d.kpiMaintained !== null);
  if (!data.length) return null;
  const min = Math.min(...data.map((d) => Math.min(d.final, d.kpiMaintained))) * 0.96;
  const max = Math.max(...data.map((d) => Math.max(d.final, d.kpiMaintained))) * 1.04;
  const X = (i) => pad.l + (i / Math.max(data.length - 1, 1)) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);

  const salaryPath = data.map((d, i) => `${i === 0 ? "M" : "L"} ${X(i)} ${Y(d.final)}`).join(" ");
  const kpiPath = data.map((d, i) => `${i === 0 ? "M" : "L"} ${X(i)} ${Y(d.kpiMaintained)}`).join(" ");
  const gapArea =
    data.map((d, i) => `${i === 0 ? "M" : "L"} ${X(i)} ${Y(d.final)}`).join(" ") +
    " " +
    data.slice().reverse().map((d, i) => `L ${X(data.length - 1 - i)} ${Y(d.kpiMaintained)}`).join(" ") +
    " Z";

  const tickStep = roundTick((max - min) / 4);
  const yTicks = [];
  for (let v = Math.ceil(min / tickStep) * tickStep; v <= max; v += tickStep) yTicks.push(v);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Kjøpekraftsgap">
      <defs>
        <linearGradient id="gap-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--positive)" stopOpacity="0.20" />
          <stop offset="100%" stopColor="var(--positive)" stopOpacity="0.04" />
        </linearGradient>
      </defs>

      {yTicks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={Y(v)} y2={Y(v)} stroke="var(--line-soft)" />
          <text x={pad.l - 10} y={Y(v) + 4} fontSize="11" fill="var(--muted)" textAnchor="end" style={{ fontVariantNumeric: "tabular-nums" }}>
            {NOK_COMPACT(v)} kr
          </text>
        </g>
      ))}

      <path d={gapArea} fill="url(#gap-fill)" />
      <path d={kpiPath} fill="none" stroke="var(--negative)" strokeWidth="2" strokeDasharray="6 7" strokeLinecap="round" />
      <path d={salaryPath} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      {data.map((d, i) => (
        <g key={d.year}>
          <circle cx={X(i)} cy={Y(d.final)} r="3.5" fill="var(--bg)" stroke="var(--primary)" strokeWidth="1.6" />
        </g>
      ))}

      {data.map((d, i) => (
        <text key={d.year} x={X(i)} y={H - pad.b + 22} fontSize="11" fill="var(--muted)" textAnchor="middle" letterSpacing="0.05em">
          {d.year}
        </text>
      ))}

      <g transform={`translate(${X(data.length - 1) + 10}, ${Y(data[data.length - 1].final)})`}>
        <text x="0" y="-6" fontSize="11" fill="var(--muted)" letterSpacing="0.1em">FAKTISK</text>
        <text x="0" y="10" fontSize="14" fontWeight="500" fill="var(--primary)" style={{ fontVariantNumeric: "tabular-nums" }}>
          {NOK_COMPACT(data[data.length - 1].final)} kr
        </text>
      </g>
      <g transform={`translate(${X(data.length - 1) + 10}, ${Y(data[data.length - 1].kpiMaintained)})`}>
        <text x="0" y="-6" fontSize="11" fill="var(--muted)" letterSpacing="0.1em">KPI</text>
        <text x="0" y="10" fontSize="14" fontWeight="500" fill="var(--negative)" style={{ fontVariantNumeric: "tabular-nums" }}>
          {NOK_COMPACT(data[data.length - 1].kpiMaintained)} kr
        </text>
      </g>
    </svg>
  );
}

function roundTick(step) {
  if (step <= 0) return 10000;
  const pow = Math.pow(10, Math.floor(Math.log10(step)));
  const norm = step / pow;
  let nice;
  if (norm <= 1) nice = 1;
  else if (norm <= 2) nice = 2;
  else if (norm <= 5) nice = 5;
  else nice = 10;
  return nice * pow;
}

function ForecastChart({ years, forecast }) {
  const W = 1100, H = 460;
  const pad = { l: 60, r: 60, t: 36, b: 56 };
  if (!years.length || !forecast.length) return null;
  const allYears = [
    ...years.map((y) => ({ year: y.year, mid: y.final, low: y.final, high: y.final, kind: "actual" })),
    ...forecast.map((f) => ({ ...f, kind: "forecast" })),
  ];
  const min = Math.min(...allYears.map((d) => d.low)) * 0.96;
  const max = Math.max(...allYears.map((d) => d.high)) * 1.04;
  const X = (i) => pad.l + (i / (allYears.length - 1)) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);

  const actualEnd = years.length - 1;
  const actualPath = allYears
    .slice(0, years.length)
    .map((d, i) => `${i === 0 ? "M" : "L"} ${X(i)} ${Y(d.mid)}`)
    .join(" ");
  const forecastPath =
    `M ${X(actualEnd)} ${Y(years[years.length - 1].final)} ` +
    forecast.map((f, i) => `L ${X(years.length + i)} ${Y(f.mid)}`).join(" ");

  const rangeArea =
    `M ${X(actualEnd)} ${Y(years[years.length - 1].final)} ` +
    forecast.map((f, i) => `L ${X(years.length + i)} ${Y(f.high)}`).join(" ") +
    " " +
    forecast.slice().reverse().map((f, i) => `L ${X(years.length - 1 + forecast.length - i)} ${Y(f.low)}`).join(" ") +
    ` L ${X(actualEnd)} ${Y(years[years.length - 1].final)} Z`;

  const tickStep = roundTick((max - min) / 4);
  const yTicks = [];
  for (let v = Math.ceil(min / tickStep) * tickStep; v <= max; v += tickStep) yTicks.push(v);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Prognose">
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={Y(v)} y2={Y(v)} stroke="var(--line-soft)" />
          <text x={pad.l - 10} y={Y(v) + 4} fontSize="11" fill="var(--muted)" textAnchor="end" style={{ fontVariantNumeric: "tabular-nums" }}>
            {NOK_COMPACT(v)} kr
          </text>
        </g>
      ))}

      <line x1={X(actualEnd)} x2={X(actualEnd)} y1={pad.t} y2={H - pad.b} stroke="var(--line)" strokeDasharray="2 5" />
      <text x={X(actualEnd) - 6} y={pad.t + 14} fontSize="10.5" fill="var(--muted)" textAnchor="end" letterSpacing="0.12em">
        I DAG
      </text>
      <text x={X(actualEnd) + 6} y={pad.t + 14} fontSize="10.5" fill="var(--muted)" letterSpacing="0.12em">
        PROGNOSE →
      </text>

      <path d={rangeArea} fill="var(--primary)" opacity="0.10" />
      <path d={actualPath} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" />
      <path d={forecastPath} fill="none" stroke="var(--primary)" strokeWidth="2" strokeDasharray="6 6" strokeLinecap="round" opacity="0.8" />

      {years.map((d, i) => (
        <circle key={d.year} cx={X(i)} cy={Y(d.final)} r="3.5" fill="var(--bg)" stroke="var(--primary)" strokeWidth="1.6" />
      ))}
      {forecast.map((f, i) => (
        <circle key={f.year} cx={X(years.length + i)} cy={Y(f.mid)} r="3" fill="var(--primary)" opacity="0.5" />
      ))}

      {allYears.map((d, i) => (
        <text key={d.year} x={X(i)} y={H - pad.b + 22} fontSize="11" fill="var(--muted)" textAnchor="middle" letterSpacing="0.05em">
          {d.year}
        </text>
      ))}
    </svg>
  );
}

// ─── Sections ─────────────────────────────────────────────────────────

function TopBar({ onEdit }) {
  return (
    <div className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true"></span>
        <span>{APP_NAME}</span>
      </div>
      <div className="topbar-right">
        <button className="btn ghost"><span className="hide-sm">{isDemoMode ? "Demo" : "Lokal"}</span> · {isDemoMode ? "nettlesar" : "SQLite"}</button>
        <button className="btn primary" onClick={onEdit}>
          Rediger dataa dine <span className="arrow">→</span>
        </button>
      </div>
    </div>
  );
}

function SectionHook({ data, onEdit }) {
  return (
    <section className="section hook">
      <div className="section-inner">
        <p className="eyebrow"><span className="step-num">01</span> Spørsmålet</p>
        <div className="grid">
          <div>
            <h1>
              Har du <span className="accent">eigentleg</span> fått betre råd dei siste åra?
            </h1>
            <p className="lead sub">
              Lønna har gått opp. Spørsmålet er om ho har gått opp meir enn prisane.
              Lim inn historikken din, så reknar appen ut svaret.
            </p>
            {data ? (
              <div className="scroll-cue">
                <span className="bar" aria-hidden="true"></span>
                Bla nedover
              </div>
            ) : (
              <div style={{ marginTop: 40, display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button className="btn primary" onClick={onEdit}>
                  Legg inn lønshistorikk <span className="arrow">→</span>
                </button>
              </div>
            )}
          </div>
          <div className="chart hook-chart" aria-label="Lønn versus inflasjon">
            <HookLines data={data} />
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionHeadline({ data }) {
  const realPct = data.totalRealGrowth;
  return (
    <section className="section">
      <div className="section-inner">
        <p className="eyebrow"><span className="step-num">02</span> Reknestykket ditt</p>
        <div className="headline-grid">
          <div>
            <div className="bignum tabular">
              {NUM(data.currentSalary)}<span className="unit">kr</span>
            </div>
            <p className="lead" style={{ marginTop: 18 }}>
              Det er årslønna di i lønsåret som starta i mai {data.currentYear}.
              Sidan {data.startYear} har {realPct !== null && realPct >= 0 ? "kjøpekrafta vakse" : realPct !== null ? "kjøpekrafta krympa" : "kjøpekrafta endra seg"}
              {realPct !== null && (
                <>
                  <strong style={{ color: realPct >= 0 ? "var(--positive)" : "var(--negative)", fontWeight: 500 }}>
                    {" "}{PCT(realPct)}
                  </strong> — det er <em>etter</em> inflasjon.
                </>
              )}
              {realPct === null && " — inflasjonstal manglar enno."}
            </p>
          </div>
          <div className="headline-rhs">
            <div className="tri-stat">
              <div className="cell">
                <div className="label">Nominell vekst</div>
                <div className="value muted tabular">{PCT(data.totalNominalGrowth)}</div>
              </div>
              <div className="cell">
                <div className="label">Prisar (KPI)</div>
                <div className="value neg tabular">{PCT(data.totalInflation)}</div>
              </div>
              <div className="cell">
                <div className="label">Reallønsvekst</div>
                <div className="value pos tabular">{PCT(data.totalRealGrowth)}</div>
              </div>
            </div>
            <p className="note">
              Frå {data.startYear} til {data.currentYear}. Inflasjon frå {data.source}.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionTimeline({ data }) {
  return (
    <section className="section">
      <div className="section-inner">
        <p className="eyebrow"><span className="step-num">03</span> Slik har lønna vakse</p>
        <div className="section-head">
          <h2>Frå {NUM(data.startSalary)} til {NUM(data.currentSalary)} kroner på {data.currentYear - data.startYear} år.</h2>
          <div className="rhs">
            <p className="lead">
              Kvar prikk er ein registrert endring. Lønsåret går frå mai til april.
              Markørar viser hendingar du sjølv har flagga.
            </p>
          </div>
        </div>
        <div className="chart">
          <TimelineChart years={data.years} steps={data.steps} chartStyle="line" />
        </div>
        <div className="legend">
          <span className="item"><span className="dot line" style={{ background: "var(--primary)" }}></span> Årsløn</span>
          <span className="item"><span className="dot" style={{ background: "var(--primary)" }}></span> Lønstrinn</span>
          <span className="item" style={{ color: "var(--ink-soft)" }}><span className="dot dash" style={{ color: "var(--positive)" }}></span> Hendingsflagg</span>
        </div>

        <div className="year-strip" style={{ "--year-cols": Math.min(data.years.length, 6) }}>
          {data.years.map((y) => (
            <div className="year-cell" key={y.year}>
              <div className="y-year">{y.year}</div>
              <div className="y-salary tabular">{NUM(y.final)} kr</div>
              <div className="y-change">
                <span className="delta" style={{ color: y.change === null ? "var(--muted)" : y.change > 0 ? "var(--positive)" : y.change < 0 ? "var(--negative)" : "var(--muted)" }}>
                  {y.change === null ? "—" : PCT(y.change)}
                </span>
                <span style={{ color: "var(--muted)" }}>{y.steps > 1 ? `${y.steps} trinn` : ""}</span>
              </div>
              {y.flag && (
                <div className="y-flag">
                  <span className="pip" style={{
                    background: y.flag.color === "blue" ? "var(--primary)" : y.flag.color === "rust" ? "var(--negative)" : "var(--positive)",
                  }}></span>
                  {y.flag.label}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SectionCompare({ data }) {
  const realYears = data.years.filter((y) => y.real !== null);
  const underYears = realYears.filter((y) => y.real < 0).length;
  const ahead = realYears.filter((y) => y.real > 0).length;

  const best = realYears.length ? realYears.reduce((a, b) => (a.real >= b.real ? a : b)) : null;
  const worst = realYears.length ? realYears.reduce((a, b) => (a.real <= b.real ? a : b)) : null;

  if (!realYears.length) return null;

  return (
    <section className="section">
      <div className="section-inner">
        <p className="eyebrow"><span className="step-num">04</span> Mot prisveksten</p>
        <div className="section-head">
          <h2>Men har du halde tritt med prisane?</h2>
          <div className="rhs">
            <p className="lead">
              Blå søyle er lønnsvekst. Raudbrun er KPI-inflasjon for same periode (mai til mai).
              Den grøne linja er differansen — reallønsvekst.
            </p>
          </div>
        </div>

        <div className="chart">
          <CompareChart years={data.years} />
        </div>
        <div className="legend">
          <span className="item"><span className="dot" style={{ background: "var(--primary)" }}></span> Lønsvekst</span>
          <span className="item"><span className="dot" style={{ background: "var(--negative)" }}></span> Inflasjon (KPI)</span>
          <span className="item"><span className="dot line" style={{ background: "var(--positive)" }}></span> Reallønsvekst</span>
        </div>

        <div className="compare-grid" style={{ marginTop: 56 }}>
          <p className="lead" style={{ maxWidth: "44ch" }}>
            Av {realYears.length} lønsår der vi har inflasjonsdata, hadde du reallønsvekst i <strong style={{ color: "var(--positive)" }}>{ahead}</strong> og låg under prisveksten i <strong style={{ color: "var(--negative)" }}>{underYears}</strong>.
          </p>
          <div className="kpi-stat-list">
            {best && (
              <div className="kpi-stat">
                <div className="lbl">Beste år</div>
                <div className="val pos tabular">{PCT(best.real)}</div>
                <div className="note">{best.year}{best.flag?.note ? ` · ${best.flag.note}` : ""}</div>
              </div>
            )}
            {worst && (
              <div className="kpi-stat">
                <div className="lbl">Svakaste år</div>
                <div className="val neg tabular">{PCT(worst.real)}</div>
                <div className="note">
                  {worst.year} · KPI {PCT(worst.inflation, 1)} · løn {PCT(worst.change, 1)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionGap({ data }) {
  const last = data.years[data.years.length - 1];
  return (
    <section className="section" style={{ background: "var(--bg-soft)" }}>
      <div className="section-inner">
        <p className="eyebrow"><span className="step-num">05</span> Kjøpekraftsgapet</p>
        <div className="section-head">
          <h2>Skilnaden i kroner.</h2>
          <div className="rhs">
            <p className="lead">
              Den stipla linja er kva lønna di hadde vore om ho berre hadde fylgt KPI.
              Den fylte linja er kva du faktisk fekk. Avstanden er kjøpekraft du har vunne eller tapt.
            </p>
          </div>
        </div>

        <div className="chart">
          <GapChart years={data.years} />
        </div>
        <div className="legend">
          <span className="item"><span className="dot line" style={{ background: "var(--primary)" }}></span> Faktisk årsløn</span>
          <span className="item"><span className="dot dash" style={{ color: "var(--negative)" }}></span> KPI-vedlikehalden løn</span>
          <span className="item"><span className="dot" style={{ background: "var(--positive)", opacity: 0.35 }}></span> Overskot i kroner</span>
        </div>

        <div className="gap-pullout">
          <div>
            <div className="pull-label">I {last.year}</div>
            <div className={`pull-num tabular ${last.gap < 0 ? "neg" : ""}`}>
              {SIGNED_NOK(last.gap)}
            </div>
          </div>
          <p className="lead" style={{ marginTop: 0 }}>
            {last.gap >= 0
              ? `Du tener ${NOK(last.gap)} meir per år enn det inflasjonen åleine skulle tilsa. Det er kjøpekraft du har vunne sidan ${data.startYear}.`
              : `Du ligg ${NOK(Math.abs(last.gap))} bak det inflasjonen åleine skulle tilsa. Det er kjøpekraft du har tapt sidan ${data.startYear}.`}
          </p>
        </div>
      </div>
    </section>
  );
}

function SectionForecast({ data }) {
  if (!data.forecast.length || data.avgYearlyRaise === null) return null;
  const lastForecast = data.forecast[data.forecast.length - 1];

  return (
    <section className="section">
      <div className="section-inner">
        <p className="eyebrow"><span className="step-num">06</span> Vegen vidare</p>
        <div className="section-head">
          <h2>Held det fram slik, er du på {NOK_COMPACT(roundToNice(lastForecast.mid))} kr i {lastForecast.year}.</h2>
          <div className="rhs">
            <p className="lead">
              Prognose framskriven med snittvekst på {PCT(data.avgYearlyRaise)} per år frå dei siste lønsåra.
              Det skraverte området viser ±2 prosentpoeng usikkerheit.
            </p>
          </div>
        </div>

        <div className="chart">
          <ForecastChart years={data.years} forecast={data.forecast} />
        </div>

        <div className="forecast-stats">
          {data.forecast.map((f) => (
            <div className="forecast-cell" key={f.year}>
              <div className="yr">Lønsår {f.year}</div>
              <div className="v tabular">{NUM(f.mid)} kr</div>
              <div className="range tabular">{NOK_COMPACT(f.low)} – {NOK_COMPACT(f.high)}</div>
            </div>
          ))}
        </div>

        <p className="note" style={{ marginTop: 28, maxWidth: "60ch" }}>
          Ein prognose er ein utstrekt linje, ikkje ei sanning. Inflasjon blir framskriven berre fram til siste publiserte SSB-måned — alt etter det er uvisst.
        </p>
      </div>
    </section>
  );
}

function roundToNice(n) {
  if (n >= 100000) return Math.round(n / 10000) * 10000;
  if (n >= 10000) return Math.round(n / 1000) * 1000;
  return Math.round(n);
}

function SectionTools({ data, onEdit }) {
  const [mode, setMode] = useState("target_salary");
  const [val, setVal] = useState("550000");
  const current = data.currentSalary;
  const latestInflation = data.years.slice().reverse().find((y) => y.inflation !== null)?.inflation ?? null;

  const calc = useMemo(() => {
    const v = parseFloat(String(val).replace(/[\s,]/g, "."));
    if (!Number.isFinite(v) || v <= 0) return null;
    let newSalary, raiseNok, raisePct;
    if (mode === "target_salary") { newSalary = v; raiseNok = v - current; raisePct = raiseNok / current; }
    else if (mode === "raise_nok") { raiseNok = v; newSalary = current + v; raisePct = v / current; }
    else { raisePct = v / 100; raiseNok = current * raisePct; newSalary = current + raiseNok; }
    if (latestInflation === null) {
      return { newSalary, raiseNok, raisePct, realRaise: null, realNok: null };
    }
    const realRaise = (1 + raisePct) / (1 + latestInflation) - 1;
    const realNok = newSalary - current * (1 + latestInflation);
    return { newSalary, raiseNok, raisePct, realRaise, realNok };
  }, [val, mode, current, latestInflation]);

  return (
    <section className="section">
      <div className="section-inner">
        <p className="eyebrow"><span className="step-num">07</span> Dine tal</p>
        <div className="section-head">
          <h2>Kva treng du å be om i neste runde?</h2>
          <div className="rhs">
            <p className="lead">
              Regn på mål-løn, økning i kroner eller prosent — og sjå kva det betyr <em>etter</em> siste kjende inflasjon.
            </p>
          </div>
        </div>

        <div className="calc-grid">
          <div className="calc-card">
            <div className="tab-row">
              <button className={mode === "target_salary" ? "active" : ""} onClick={() => { setMode("target_salary"); setVal("550000"); }}>Mål-løn</button>
              <button className={mode === "raise_nok" ? "active" : ""} onClick={() => { setMode("raise_nok"); setVal("30000"); }}>Økning (kr)</button>
              <button className={mode === "raise_percent" ? "active" : ""} onClick={() => { setMode("raise_percent"); setVal("5"); }}>Økning (%)</button>
            </div>
            <div className="calc-input-row">
              <input
                inputMode="decimal"
                value={val}
                onChange={(e) => setVal(e.target.value)}
                aria-label="Ynskt verdi"
              />
              <span className="suf">{mode === "raise_percent" ? "%" : "kr"}</span>
            </div>
            {calc && (
              <div className="calc-result">
                <div className="cell">
                  <div className="lbl">Ny årsløn</div>
                  <div className="v tabular">{NOK(Math.round(calc.newSalary))}</div>
                  <div className="note">Frå {NOK(current)}</div>
                </div>
                <div className="cell">
                  <div className="lbl">Økning</div>
                  <div className={`v tabular ${calc.raiseNok < 0 ? "neg" : ""}`}>{SIGNED_NOK(Math.round(calc.raiseNok))}</div>
                  <div className="note">{PCT(calc.raisePct)} av dagens løn</div>
                </div>
                <div className="cell">
                  <div className="lbl">Reell økning</div>
                  <div className={`v tabular ${calc.realRaise === null ? "" : calc.realRaise >= 0 ? "pos" : "neg"}`}>
                    {calc.realRaise === null ? "—" : PCT(calc.realRaise)}
                  </div>
                  <div className="note">
                    {latestInflation === null ? "Siste inflasjon manglar" : `Etter inflasjon på ${PCT(latestInflation)}`}
                  </div>
                </div>
                <div className="cell">
                  <div className="lbl">Kjøpekraft</div>
                  <div className="v tabular">{calc.realNok === null ? "—" : SIGNED_NOK(Math.round(calc.realNok))}</div>
                  <div className="note">Endring i reell verdi</div>
                </div>
              </div>
            )}
            <p className="calc-script">
              {calc && calc.realRaise !== null && calc.realRaise >= 0
                ? `Eit slikt nivå gjev ${PCT(calc.realRaise)} reell vekst — du held klart tritt med prisane.`
                : calc && calc.realRaise !== null
                  ? `Eit slikt nivå gjev ${PCT(calc.realRaise)} reell vekst — under inflasjonen. Du tapar kjøpekraft.`
                  : calc
                    ? "Reell vekst kan ikkje reknast ut før vi har siste inflasjonstal."
                    : "Skriv eit tal for å sjå rekneestykket."}
            </p>
          </div>

          <div className="tools-card">
            <h3>Tala dine, dine</h3>
            <p style={{ color: "var(--ink-soft)", fontSize: 15 }}>
              Lim inn lønshistorikken frå HR-systemet, legg til rader manuelt, eller flagg år
              med forfremjing, permisjon eller sjukefråvær.
            </p>
            <ul>
              <li>Lim inn frå HR-systemet — appen kjenner att vanlege formatar</li>
              <li>Endre startmånad for lønsåret om verksemda di ikkje køyrer mai-til-april</li>
              <li>Flagg år så du seinare hugsar kvifor lønsveksten såg ut som ho gjorde</li>
              <li>{isDemoMode ? "Lagring skjer i nettlesaren — ingenting går til skya." : "Inflasjon kjem frå SSB, ingen kall ut over."}</li>
            </ul>
            <button className="btn primary" style={{ marginTop: 8, alignSelf: "flex-start" }} onClick={onEdit}>
              Rediger dataa dine <span className="arrow">→</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer({ source }) {
  return (
    <footer className="footer">
      <div className="left">
        <span className="brand-mark" aria-hidden="true" style={{ width: 14, height: 14 }}></span>
        <span>{APP_NAME} · {isDemoMode ? "statisk demo" : "lokal lønslogg"}</span>
      </div>
      <div>Inflasjon: {source}</div>
      <div style={{ color: "var(--ink-soft)" }}>
        {isDemoMode ? "Data ligg i din nettlesar." : "Ingen AI, ingen tredjepart, ingen analyse i skya."}
      </div>
    </footer>
  );
}

// ─── Drawer ───────────────────────────────────────────────────────────

function DataDrawer({
  open, onClose, summary, entries, flags, startMonth,
  onImportPaste, onAddManual, onDeleteEntry,
  onAddFlag, onDeleteFlag, onChangeStartMonth,
  error, message,
}) {
  const [paste, setPaste] = useState("");
  const [tab, setTab] = useState("paste");
  const [manual, setManual] = useState({ from: "", to: "", amount: "" });
  const [flag, setFlag] = useState({
    year: summary?.yearly?.length
      ? summary.yearly[summary.yearly.length - 1].salary_year
      : new Date().getFullYear(),
    label: "",
    color: "blue",
  });

  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
    return undefined;
  }, [open]);

  return (
    <>
      <div className={`drawer-overlay${open ? " open" : ""}`} onClick={onClose} />
      <aside className={`drawer${open ? " open" : ""}`} aria-hidden={!open} aria-label="Rediger dataa dine">
        <div className="drawer-head">
          <h3>Dine tal</h3>
          <button className="btn ghost" onClick={onClose} aria-label="Lukk">Lukk ✕</button>
        </div>
        <div className="drawer-body">

          {error && <div className="status-banner error">{error}</div>}
          {message && !error && <div className="status-banner">{message}</div>}

          <section>
            <h4>Lønsår startar i</h4>
            <div className="field" style={{ maxWidth: 220 }}>
              <select value={startMonth} onChange={(e) => onChangeStartMonth(Number(e.target.value))}>
                {MONTHS_NN.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
          </section>

          <section>
            <h4>Legg til lønshistorikk</h4>
            <div className="tab-row" style={{ marginBottom: 16 }}>
              <button className={tab === "paste" ? "active" : ""} onClick={() => setTab("paste")}>Lim inn</button>
              <button className={tab === "manual" ? "active" : ""} onClick={() => setTab("manual")}>Manuelt</button>
            </div>

            {tab === "paste" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="format-help">
                  Eitt par per rad: <code>YYYY-MM-DD</code>, <code>DD.MM.YYYY</code>, <code>DD-MM-YYYY</code> eller <code>DD/MM/YYYY</code> (valfri sluttdato) på fyrste linje, årsløn på neste.
                  HR-utklipp med <code>NOK</code> framføre og overskrifter går òg fint.
                </div>
                <div className="field">
                  <textarea
                    rows="10"
                    placeholder={"2026-05-01\nNOK 520000\n\n2025-05-01 2026-04-30\n495000"}
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                  />
                </div>
                <button className="btn primary" onClick={() => { if (paste.trim()) { onImportPaste(paste); setPaste(""); } }}>
                  Importer
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="row-2">
                  <div className="field">
                    <span>Gyldig frå</span>
                    <input type="date" value={manual.from} onChange={(e) => setManual({ ...manual, from: e.target.value })} />
                  </div>
                  <div className="field">
                    <span>Gyldig til</span>
                    <input type="date" value={manual.to} onChange={(e) => setManual({ ...manual, to: e.target.value })} />
                  </div>
                </div>
                <div className="field">
                  <span>Årsløn (NOK)</span>
                  <input inputMode="numeric" value={manual.amount} placeholder="520000" onChange={(e) => setManual({ ...manual, amount: e.target.value })} />
                </div>
                <button
                  className="btn primary"
                  onClick={() => {
                    if (manual.from && manual.amount) {
                      onAddManual({ valid_from: manual.from, valid_to: manual.to || null, amount_nok: Number(manual.amount) });
                      setManual({ from: "", to: "", amount: "" });
                    }
                  }}
                >
                  Legg til
                </button>
              </div>
            )}
          </section>

          <section>
            <h4>Registrerte rader · {entries.length}</h4>
            <div className="entry-list">
              {entries.length === 0 && <p className="note" style={{ padding: "12px 0" }}>Ingen rader registrert enno.</p>}
              {entries.map((s) => (
                <div className="entry" key={s.id}>
                  <div className="from-to">{s.valid_from} → {s.valid_to || "løpande"}</div>
                  <div className="amt">{NOK(s.amount_nok)}</div>
                  <button onClick={() => onDeleteEntry(s.id)} aria-label={`Slett rad ${s.id}`}>Slett</button>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h4>Flagg eit lønsår</h4>
            <div className="row-2">
              <div className="field">
                <span>Lønsår</span>
                <input type="number" value={flag.year} onChange={(e) => setFlag({ ...flag, year: Number(e.target.value) })} />
              </div>
              <div className="field">
                <span>Farge</span>
                <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                  {FLAG_COLORS.map((c) => (
                    <button
                      key={c.name}
                      onClick={() => setFlag({ ...flag, color: c.name })}
                      type="button"
                      style={{
                        appearance: "none",
                        border: "2px solid " + (flag.color === c.name ? "var(--ink)" : "transparent"),
                        width: 32,
                        height: 32,
                        background: c.hex,
                        borderRadius: 999,
                        cursor: "pointer",
                      }}
                      aria-label={`Vel farge ${c.name}`}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <span>Etikett</span>
              <input value={flag.label} onChange={(e) => setFlag({ ...flag, label: e.target.value })} placeholder="Forfremjing, permisjon, …" />
            </div>
            <button
              className="btn primary"
              style={{ marginTop: 14 }}
              onClick={() => {
                if (flag.label.trim()) {
                  const colorHex = FLAG_COLORS.find((c) => c.name === flag.color)?.hex || FLAG_COLORS[0].hex;
                  onAddFlag({ salary_year: flag.year, label: flag.label.trim(), color: colorHex, note: null });
                  setFlag({ ...flag, label: "" });
                }
              }}
            >
              Lagre flagg
            </button>

            {flags.length > 0 && (
              <div className="entry-list" style={{ marginTop: 18 }}>
                {flags.map((f) => (
                  <div className="entry" key={f.id}>
                    <div className="from-to">Lønsår {f.salary_year}</div>
                    <div className="amt">{f.label}</div>
                    <button onClick={() => onDeleteFlag(f.id)} aria-label={`Slett flagg ${f.id}`}>Slett</button>
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>
      </aside>
    </>
  );
}

// ─── App ──────────────────────────────────────────────────────────────

function App() {
  const [summary, setSummary] = useState(null);
  const [entries, setEntries] = useState([]);
  const [flags, setFlags] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function refresh() {
    const [s, e, f] = await Promise.all([
      dataService.getSummary(),
      dataService.getSalaryEntries(),
      dataService.getYearFlags(),
    ]);
    setSummary(s);
    setEntries(e);
    setFlags(f);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []);

  async function run(action, ok) {
    setError("");
    setMessage("");
    try {
      await action();
      await refresh();
      setMessage(typeof ok === "function" ? ok() : ok);
    } catch (err) {
      setError(err.message);
    }
  }

  function handleImportPaste(text) {
    let imported = 0;
    run(async () => {
      const r = await dataService.importSalaryText(text);
      imported = r.imported;
    }, () => `Importerte ${imported} rader.`);
  }

  function handleAddManual(payload) {
    run(() => dataService.saveSalaryEntry(null, payload), "Lønsrad lagra.");
  }

  function handleDeleteEntry(id) {
    run(() => dataService.deleteSalaryEntry(id), "Rad sletta.");
  }

  function handleAddFlag(payload) {
    run(() => dataService.saveYearFlag(null, payload), "Flagg lagra.");
  }

  function handleDeleteFlag(id) {
    run(() => dataService.deleteYearFlag(id), "Flagg sletta.");
  }

  function handleChangeStartMonth(value) {
    run(() => dataService.updateStartMonth(value), "Startmånad oppdatert.");
  }

  const adapted = useMemo(() => adaptSummary(summary), [summary]);
  const startMonth = summary?.salary_year_start_month || 5;
  const sourceText = adapted?.source || "SSB tabell 14709 · KPI totalindeks (2025=100)";

  return (
    <>
      <TopBar onEdit={() => setDrawerOpen(true)} />

      <SectionHook data={adapted} onEdit={() => setDrawerOpen(true)} />

      {adapted ? (
        <>
          <SectionHeadline data={adapted} />
          <SectionTimeline data={adapted} />
          {adapted.years.some((y) => y.real !== null) && <SectionCompare data={adapted} />}
          {adapted.years.length > 1 && <SectionGap data={adapted} />}
          {adapted.forecast.length > 0 && <SectionForecast data={adapted} />}
          <SectionTools data={adapted} onEdit={() => setDrawerOpen(true)} />
        </>
      ) : (
        <section className="section">
          <div className="section-inner">
            <p className="eyebrow"><span className="step-num">02</span> Ingen data enno</p>
            <div className="empty-cta">
              <h2>Legg til lønshistorikken så fortel appen resten av historia.</h2>
              <p className="blurb lead">
                Lim inn frå HR-systemet, eller skriv inn manuelt. Appen reknar ut nominelle og reelle endringar,
                gapet mot KPI, og gir deg ein prognose.
              </p>
            </div>
            <div style={{ marginTop: 28 }}>
              <button className="btn primary" onClick={() => setDrawerOpen(true)}>
                Opne datapanelet <span className="arrow">→</span>
              </button>
            </div>
          </div>
        </section>
      )}

      <Footer source={sourceText} />

      <DataDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        summary={summary}
        entries={entries}
        flags={flags}
        startMonth={startMonth}
        onImportPaste={handleImportPaste}
        onAddManual={handleAddManual}
        onDeleteEntry={handleDeleteEntry}
        onAddFlag={handleAddFlag}
        onDeleteFlag={handleDeleteFlag}
        onChangeStartMonth={handleChangeStartMonth}
        error={error}
        message={message}
      />
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
