import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildMeta, buildMonthlyCpi, parseSsbCsv, renderJs, renderPython, updateInflationData } from "../scripts/update_inflation_data.mjs";

const metadata = {
  label: "14709: Consumer price index, by month (2025=100) 1920-2026",
  source: "Statistics Norway",
  updated: "2026-05-11T06:00:00Z",
  dimension: {
    ContentsCode: {
      extension: {
        basePeriod: {
          KpiIndMnd: "2025",
        },
      },
    },
  },
};

const csv = `"Maaned";"KpiIndMnd 2025";"KpiIndMnd 2026"
"90";100.0;.
"01";98.1;101.6
"02";99.5;102.2
"03";98.8;102.4
"04";99.4;102.8
"05";99.9;.
`;

test("buildMonthlyCpi ignores annual average and normalizes populated months", () => {
  const monthlyCpi = buildMonthlyCpi(parseSsbCsv(csv));

  assert.deepEqual(Object.keys(monthlyCpi), [
    "2025-01",
    "2025-02",
    "2025-03",
    "2025-04",
    "2025-05",
    "2026-01",
    "2026-02",
    "2026-03",
    "2026-04",
  ]);
  assert.equal(monthlyCpi["2025-01"], 98.1);
  assert.equal(monthlyCpi["2026-04"], 102.8);
  assert.equal(monthlyCpi["2026-05"], undefined);
});

test("buildMeta records source timing and latest populated month", () => {
  const monthlyCpi = buildMonthlyCpi(parseSsbCsv(csv));
  const meta = buildMeta(metadata, monthlyCpi, "2026-05-19T10:00:00.000Z");

  assert.equal(meta.table, "14709");
  assert.equal(meta.base_period, "2025=100");
  assert.equal(meta.updated, "2026-05-11T06:00:00Z");
  assert.equal(meta.generated_at, "2026-05-19T10:00:00.000Z");
  assert.equal(meta.first_month, "2025-01");
  assert.equal(meta.latest_month, "2026-04");
});

test("renderers emit matching JS and Python CPI values", () => {
  const monthlyCpi = buildMonthlyCpi(parseSsbCsv(csv));
  const meta = buildMeta(metadata, monthlyCpi, "2026-05-19T10:00:00.000Z");
  const source = "SSB StatBank tabell 14709, KPI totalindeks (2025=100)";

  const js = renderJs({ source, meta, monthlyCpi });
  const python = renderPython({ source, meta, monthlyCpi });

  assert.match(js, /export const INFLATION_DATA_META/);
  assert.match(js, /"2026-04": 102.8/);
  assert.match(python, /INFLATION_DATA_META = /);
  assert.match(python, /"2026-04": 102.8,/);
});

test("updateInflationData preserves generated timestamp when SSB data is unchanged", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "inflation-data-"));
  await mkdir(join(rootDir, "src"), { recursive: true });
  const monthlyCpi = buildMonthlyCpi(parseSsbCsv(csv));
  const existingMeta = buildMeta(metadata, monthlyCpi, "2026-05-19T10:00:00.000Z");
  const source = "SSB StatBank tabell 14709, KPI totalindeks (2025=100)";
  await writeFile(join(rootDir, "src", "inflationData.js"), renderJs({ source, meta: existingMeta, monthlyCpi }), "utf8");

  const result = await updateInflationData({
    rootDir,
    generatedAt: "2026-05-20T10:00:00.000Z",
    metadataUrl: `data:application/json,${encodeURIComponent(JSON.stringify(metadata))}`,
    dataUrl: `data:text/csv,${encodeURIComponent(csv)}`,
  });
  const generatedJs = await readFile(join(rootDir, "src", "inflationData.js"), "utf8");

  assert.equal(result.meta.generated_at, "2026-05-19T10:00:00.000Z");
  assert.match(generatedJs, /2026-05-19T10:00:00.000Z/);
  assert.doesNotMatch(generatedJs, /2026-05-20T10:00:00.000Z/);
});
