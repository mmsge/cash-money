import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SSB_TABLE_ID = "14709";
export const SSB_METADATA_URL = `https://data.ssb.no/api/pxwebapi/v2/tables/${SSB_TABLE_ID}/metadata?lang=en`;
export const SSB_DATA_URL =
  `https://data.ssb.no/api/pxwebapi/v2/tables/${SSB_TABLE_ID}/data?` +
  new URLSearchParams({
    lang: "en",
    "valueCodes[Maaned]": "*",
    "valueCodes[ContentsCode]": "KpiIndMnd",
    "valueCodes[Tid]": "from(1920)",
    outputFormat: "csv",
    outputFormatParams: "SeparatorSemicolon,UseCodes",
  }).toString();

const MONTH_CODE_TO_NUMBER = {
  "01": "01",
  "02": "02",
  "03": "03",
  "04": "04",
  "05": "05",
  "06": "06",
  "07": "07",
  "08": "08",
  "09": "09",
  10: "10",
  11: "11",
  12: "12",
};

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ";" && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

export function parseSsbCsv(csv) {
  const lines = csv
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) throw new Error("SSB CSV did not contain data rows.");

  const header = parseCsvLine(lines[0]);
  const years = header.slice(1).map((label) => {
    const match = label.match(/\b(\d{4})$/);
    if (!match) throw new Error(`Could not parse year from SSB column: ${label}`);
    return match[1];
  });

  return lines.slice(1).map((line) => {
    const [monthCode, ...rawValues] = parseCsvLine(line);
    return {
      monthCode,
      values: Object.fromEntries(
        years.map((year, index) => {
          const value = rawValues[index];
          return [year, value === "." || value === "" || value === undefined ? null : Number(value)];
        }),
      ),
    };
  });
}

export function buildMonthlyCpi(rows) {
  const entries = [];

  for (const row of rows) {
    const month = MONTH_CODE_TO_NUMBER[row.monthCode];
    if (!month) continue;
    for (const [year, value] of Object.entries(row.values)) {
      if (value === null || Number.isNaN(value)) continue;
      entries.push([`${year}-${month}`, value]);
    }
  }

  entries.sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

export function buildMeta(metadata, monthlyCpi, generatedAt = new Date().toISOString()) {
  const months = Object.keys(monthlyCpi).sort();
  const basePeriod = metadata?.dimension?.ContentsCode?.extension?.basePeriod?.KpiIndMnd || "2025";

  return {
    table: SSB_TABLE_ID,
    label: metadata.label,
    source: metadata.source || "Statistics Norway",
    updated: metadata.updated,
    base_period: `${basePeriod}=100`,
    generated_at: generatedAt,
    first_month: months[0] || null,
    latest_month: months.at(-1) || null,
  };
}

export function renderJs({ source, meta, monthlyCpi }) {
  return `export const INFLATION_SOURCE = ${JSON.stringify(source)};\n\n` +
    `export const INFLATION_DATA_META = Object.freeze(${JSON.stringify(meta, null, 2)});\n\n` +
    `export const CPI_INDEX_BY_MONTH = Object.freeze(${JSON.stringify(monthlyCpi, null, 2)});\n`;
}

export function renderPython({ source, meta, monthlyCpi }) {
  const cpiLines = Object.entries(monthlyCpi)
    .map(([key, value]) => `    ${JSON.stringify(key)}: ${value},`)
    .join("\n");

  return `INFLATION_SOURCE = ${JSON.stringify(source)}\n\n` +
    `INFLATION_DATA_META = ${JSON.stringify(meta, null, 4)}\n\n` +
    `CPI_INDEX_BY_MONTH = {\n${cpiLines}\n}\n`;
}

async function readExistingJsMeta(rootDir) {
  try {
    const content = await readFile(resolve(rootDir, "src/inflationData.js"), "utf8");
    const metaMatch = content.match(/export const INFLATION_DATA_META = Object\.freeze\((\{[\s\S]*?\})\);/);
    const cpiMatch = content.match(/export const CPI_INDEX_BY_MONTH = Object\.freeze\((\{[\s\S]*?\})\);/);
    if (!metaMatch || !cpiMatch) return null;
    return {
      meta: JSON.parse(metaMatch[1]),
      monthlyCpi: JSON.parse(cpiMatch[1]),
    };
  } catch {
    return null;
  }
}

function stableJson(value) {
  return JSON.stringify(value);
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`SSB request failed ${response.status}: ${url}`);
  return response.text();
}

export async function updateInflationData({
  metadataUrl = SSB_METADATA_URL,
  dataUrl = SSB_DATA_URL,
  generatedAt = new Date().toISOString(),
  rootDir = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
} = {}) {
  const [metadata, csv] = await Promise.all([fetchText(metadataUrl).then(JSON.parse), fetchText(dataUrl)]);
  const monthlyCpi = buildMonthlyCpi(parseSsbCsv(csv));
  const existing = await readExistingJsMeta(rootDir);
  if (
    existing &&
    existing.meta?.updated === metadata.updated &&
    stableJson(existing.monthlyCpi) === stableJson(monthlyCpi) &&
    existing.meta?.generated_at
  ) {
    generatedAt = existing.meta.generated_at;
  }
  const meta = buildMeta(metadata, monthlyCpi, generatedAt);
  const source = `SSB StatBank tabell ${SSB_TABLE_ID}, KPI totalindeks (${meta.base_period})`;

  const jsPath = resolve(rootDir, "src/inflationData.js");
  const pyPath = resolve(rootDir, "server/inflation_data.py");
  await Promise.all([mkdir(dirname(jsPath), { recursive: true }), mkdir(dirname(pyPath), { recursive: true })]);
  await Promise.all([
    writeFile(jsPath, renderJs({ source, meta, monthlyCpi }), "utf8"),
    writeFile(pyPath, renderPython({ source, meta, monthlyCpi }), "utf8"),
  ]);

  return { meta, count: Object.keys(monthlyCpi).length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  updateInflationData()
    .then(({ meta, count }) => {
      console.log(`Updated ${count} CPI months from SSB ${SSB_TABLE_ID}; latest month ${meta.latest_month}.`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
