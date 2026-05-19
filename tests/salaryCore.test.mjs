import assert from "node:assert/strict";
import test from "node:test";

import { buildDashboard, buildSummary, inflationForSalaryYear, parseSalaryText } from "../src/salaryCore.js";
import { dataService, isDemoMode } from "../src/dataService.js";
import { CPI_INDEX_BY_MONTH, INFLATION_DATA_META } from "../src/inflationData.js";
import { sampleText } from "../src/sampleData.js";

test("parseSalaryText parses the HR salary sample", () => {
  const entries = parseSalaryText(sampleText);

  assert.equal(entries.length, 7);
  assert.equal(entries[0].valid_from, "2021-08-09");
  assert.equal(entries[0].amount_nok, 400000);
  assert.equal(entries.at(-1).valid_from, "2026-05-01");
  assert.equal(entries.at(-1).valid_to, null);
  assert.equal(entries.at(-1).amount_nok, 520000);
});

test("parseSalaryText supports mixed day-first and ISO pasted date formats", () => {
  const text = `02.05.2025 01052026
NOK 800000
2024-05-01 30-04-2025
760000
09082021 30042022
NOK 555000`;
  const entries = parseSalaryText(text);

  assert.equal(entries.length, 3);
  assert.equal(entries[0].valid_from, "2021-08-09");
  assert.equal(entries[0].valid_to, "2022-04-30");
  assert.equal(entries[1].valid_from, "2024-05-01");
  assert.equal(entries[1].valid_to, "2025-04-30");
  assert.equal(entries[2].valid_from, "2025-05-02");
  assert.equal(entries[2].valid_to, "2026-05-01");
});

test("parseSalaryText rejects invalid day-first calendar dates", () => {
  assert.throws(() => parseSalaryText("32.01.2024\nNOK 500000"), /Ugyldig dato/);
});

test("buildSummary matches the backend grouping and forecast defaults", () => {
  const entries = parseSalaryText(sampleText).map((entry, index) => ({ id: index + 1, ...entry }));
  const summary = buildSummary(entries, [], 5);
  const yearly = Object.fromEntries(summary.yearly.map((item) => [item.salary_year, item]));

  assert.equal(summary.salary_year_start_month, 5);
  assert.equal(yearly[2022].final_amount_nok, 430000);
  assert.equal(yearly[2022].steps.length, 2);
  assert.equal(yearly[2023].final_amount_nok, 450000);
  assert.equal(yearly[2023].change_nok, 20000);
  assert.equal(yearly[2023].change_percent, 4.65);
  assert.equal(yearly[2023].inflation_percent, 2.98);
  assert.equal(yearly[2023].real_change_percent, 1.67);
  assert.equal(yearly[2023].inflation_period, "2023-05 til 2024-05");
  assert.match(yearly[2023].inflation_source, /SSB StatBank/);
  assert.equal(yearly[2025].inflation_percent, 2.9);
  assert.equal(yearly[2025].inflation_preliminary, true);
  assert.equal(yearly[2025].inflation_period, "2025-05 til 2026-04 (foreløpig, mål 2026-05)");
  assert.equal(yearly[2025].real_change_percent, 2.42);
  assert.equal(summary.dashboard.current_salary_nok, 520000);
  assert.equal(summary.dashboard.total_nominal_growth_percent, 30);
  assert.equal(summary.dashboard.cumulative_real_growth_percent, 5.46);
  assert.equal(summary.dashboard.below_inflation_years_count, 0);
  assert.equal(summary.dashboard.purchasing_power_adjustment_nok, 0);
  assert.equal(summary.predictions.average_change_percent, 5.39);
  assert.equal(summary.predictions.based_on_years, 5);
  assert.equal(summary.predictions.items[0].salary_year, 2027);
  assert.equal(summary.predictions.items[0].predicted_amount_nok, 548028);
});

test("buildSummary recalculates when the salary year starts in January", () => {
  const entries = parseSalaryText(sampleText).map((entry, index) => ({ id: index + 1, ...entry }));
  const summary = buildSummary(entries, [], 1);
  const yearly = Object.fromEntries(summary.yearly.map((item) => [item.salary_year, item]));

  assert.equal(summary.salary_year_start_month, 1);
  assert.equal(yearly[2022].final_amount_nok, 430000);
  assert.equal(yearly[2022].change_percent, 7.5);
  assert.equal(yearly[2022].inflation_period, "2022-01 til 2023-01");
  assert.equal(yearly[2022].inflation_percent, 7.02);
  assert.equal(yearly[2022].real_change_percent, 0.48);
  assert.equal(summary.dashboard.cumulative_real_growth_percent, 4.71);
  assert.equal(summary.dashboard.below_inflation_years_count, 1);
});

test("buildDashboard computes purchasing power gap and below-inflation years from yearly summary data", () => {
  const dashboard = buildDashboard([
    { salary_year: 2021, final_amount_nok: 500000, change_percent: null, inflation_percent: 2.5 },
    { salary_year: 2022, final_amount_nok: 510000, change_percent: 2, inflation_percent: 3 },
    { salary_year: 2023, final_amount_nok: 520000, change_percent: 1.96, inflation_percent: null },
  ]);

  assert.equal(dashboard.current_salary_nok, 520000);
  assert.equal(dashboard.total_nominal_growth_percent, 4);
  assert.equal(dashboard.cumulative_real_growth_percent, -1.49);
  assert.equal(dashboard.below_inflation_years_count, 1);
  assert.equal(dashboard.purchasing_power_adjustment_nok, 7875);
});

test("inflationForSalaryYear returns null when the end month is missing", () => {
  const inflation = inflationForSalaryYear(2026, 5);

  assert.equal(inflation.inflation_period, "2026-05 til 2027-05");
  assert.equal(inflation.inflation_percent, null);
  assert.equal(inflation.inflation_preliminary, false);
});

test("inflationForSalaryYear returns preliminary inflation when only the full end month is missing", () => {
  const inflation = inflationForSalaryYear(2025, 5);

  assert.equal(inflation.inflation_period, "2025-05 til 2026-04 (foreløpig, mål 2026-05)");
  assert.equal(inflation.inflation_percent, 2.9);
  assert.equal(inflation.inflation_preliminary, true);
});

test("embedded SSB CPI data includes historical and latest generated coverage", () => {
  const months = Object.keys(CPI_INDEX_BY_MONTH).sort();

  assert.equal(INFLATION_DATA_META.table, "14709");
  assert.equal(INFLATION_DATA_META.base_period, "2025=100");
  assert.equal(INFLATION_DATA_META.first_month, "1920-03");
  assert.equal(INFLATION_DATA_META.latest_month, months.at(-1));
  assert.ok(INFLATION_DATA_META.latest_month >= "2026-04");
  assert.equal(CPI_INDEX_BY_MONTH["1920-03"], 3.7);
  assert.equal(CPI_INDEX_BY_MONTH["2026-04"], 102.8);
});

test("default frontend data service remains API-backed", () => {
  assert.equal(isDemoMode, false);
  assert.equal(dataService.mode, "api");
});
