import { CPI_INDEX_BY_MONTH, INFLATION_DATA_META, INFLATION_SOURCE } from "./inflationData.js";

export const DEFAULT_SALARY_YEAR_START_MONTH = 5;

function parseIsoDate(value) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime())) {
    throw new Error(`Ugyldig dato: ${value}`);
  }
  return parsed;
}

function normalizeDateToken(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const dayFirstSeparated = value.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (dayFirstSeparated) {
    const day = dayFirstSeparated[1].padStart(2, "0");
    const month = dayFirstSeparated[2].padStart(2, "0");
    const year = dayFirstSeparated[3];
    return `${year}-${month}-${day}`;
  }
  const dayFirstCompact = value.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (dayFirstCompact) {
    const day = dayFirstCompact[1];
    const month = dayFirstCompact[2];
    const year = dayFirstCompact[3];
    return `${year}-${month}-${day}`;
  }
  return null;
}

function parseDateLine(line) {
  const match = String(line || "").trim().match(/^(\S+)(?:\s+(\S+))?$/);
  if (!match) return null;
  const validFrom = normalizeDateToken(match[1]);
  if (!validFrom) return null;
  const validTo = match[2] ? normalizeDateToken(match[2]) : null;
  if (match[2] && !validTo) return null;
  parseIsoDate(validFrom);
  if (validTo) parseIsoDate(validTo);
  return { valid_from: validFrom, valid_to: validTo };
}

export function validateSalaryEntry(payload) {
  const validFrom = String(payload.valid_from || "").trim();
  const validTo = payload.valid_to === null || payload.valid_to === undefined ? null : String(payload.valid_to).trim() || null;
  const amount = Number.parseInt(payload.amount_nok, 10);

  if (!validFrom) throw new Error("Gyldig fra mangler.");
  const fromDate = parseIsoDate(validFrom);
  const toDate = validTo ? parseIsoDate(validTo) : null;
  if (toDate && toDate < fromDate) throw new Error("Gyldig til kan ikke være før gyldig fra.");
  if (!Number.isInteger(amount)) throw new Error("Årslønn må være et heltall.");
  if (amount <= 0) throw new Error("Årslønn må være større enn 0.");

  return { valid_from: validFrom, valid_to: validTo, amount_nok: amount };
}

export function parseSalaryText(text) {
  const lines = text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const entries = [];
  const amountPattern = /^(?:NOK\s*)?([\d\s.,]+)$/i;

  let index = 0;
  while (index < lines.length) {
    const dateEntry = parseDateLine(lines[index]);
    if (!dateEntry) {
      index += 1;
      continue;
    }
    index += 1;
    while (index < lines.length) {
      const amountMatch = lines[index].match(amountPattern);
      if (amountMatch) {
        const amountText = amountMatch[1].replaceAll(" ", "").replaceAll(".", "").replaceAll(",", "");
        entries.push(validateSalaryEntry({ ...dateEntry, amount_nok: amountText }));
        index += 1;
        break;
      }
      if (parseDateLine(lines[index])) break;
      index += 1;
    }
  }

  if (!entries.length) throw new Error("Fant ingen lønnsrader i teksten.");
  return entries.sort((a, b) => a.valid_from.localeCompare(b.valid_from));
}

export function salaryYearFor(validFrom, startMonth) {
  const parsed = parseIsoDate(validFrom);
  const month = parsed.getUTCMonth() + 1;
  const year = parsed.getUTCFullYear();
  return month >= startMonth ? year : year - 1;
}

function roundPercent(value) {
  return Math.round(value * 100) / 100;
}

function monthKey(year, month) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export function inflationForSalaryYear(salaryYear, startMonth) {
  const startKey = monthKey(salaryYear, startMonth);
  const endKey = monthKey(salaryYear + 1, startMonth);
  const startIndex = CPI_INDEX_BY_MONTH[startKey];
  const endIndex = CPI_INDEX_BY_MONTH[endKey];
  const latestKey = INFLATION_DATA_META.latest_month;
  const latestIndex = latestKey ? CPI_INDEX_BY_MONTH[latestKey] : undefined;
  const hasPreliminaryEnd = startIndex !== undefined && endIndex === undefined && latestKey > startKey && latestKey < endKey && latestIndex !== undefined;
  const comparisonEndKey = endIndex === undefined && hasPreliminaryEnd ? latestKey : endKey;
  const comparisonEndIndex = endIndex === undefined && hasPreliminaryEnd ? latestIndex : endIndex;

  return {
    inflation_period: hasPreliminaryEnd ? `${startKey} til ${comparisonEndKey} (foreløpig, mål ${endKey})` : `${startKey} til ${endKey}`,
    inflation_source: INFLATION_SOURCE,
    inflation_preliminary: hasPreliminaryEnd,
    inflation_percent:
      startIndex === undefined || comparisonEndIndex === undefined ? null : roundPercent(((comparisonEndIndex - startIndex) / startIndex) * 100),
  };
}

export function buildPredictions(yearly, yearsAhead = 3) {
  const changes = yearly
    .filter((year) => year.change_percent !== null && year.change_percent !== undefined && year.final_amount_nok !== null)
    .map((year) => Number(year.change_percent));
  if (!yearly.length || !changes.length) {
    return {
      method: "average_yearly_percent_change",
      average_change_percent: null,
      based_on_years: 0,
      items: [],
    };
  }

  const averageChangePercent = Math.round((changes.reduce((sum, value) => sum + value, 0) / changes.length) * 100) / 100;
  const growthFactor = 1 + averageChangePercent / 100;
  const latest = yearly.at(-1);
  let amount = Number(latest.final_amount_nok);
  const predictions = [];

  for (let offset = 1; offset <= yearsAhead; offset += 1) {
    amount = Math.round(amount * growthFactor);
    predictions.push({
      salary_year: Number(latest.salary_year) + offset,
      predicted_amount_nok: amount,
      predicted_change_percent: averageChangePercent,
    });
  }

  return {
    method: "average_yearly_percent_change",
    average_change_percent: averageChangePercent,
    based_on_years: changes.length,
    items: predictions,
  };
}

export function buildSummary(entries, flags, startMonth = DEFAULT_SALARY_YEAR_START_MONTH) {
  const normalizedStartMonth = Number.isInteger(startMonth) && startMonth >= 1 && startMonth <= 12 ? startMonth : DEFAULT_SALARY_YEAR_START_MONTH;
  const sortedEntries = [...entries].sort((a, b) => a.valid_from.localeCompare(b.valid_from) || a.id - b.id);
  const sortedFlags = [...flags].sort((a, b) => a.salary_year - b.salary_year || a.id - b.id);
  const flagsByYear = new Map();
  for (const flag of sortedFlags) {
    const yearFlags = flagsByYear.get(flag.salary_year) || [];
    yearFlags.push(flag);
    flagsByYear.set(flag.salary_year, yearFlags);
  }

  const years = new Map();
  const steps = [];
  for (const entry of sortedEntries) {
    const salaryYear = salaryYearFor(entry.valid_from, normalizedStartMonth);
    const step = { ...entry, salary_year: salaryYear };
    steps.push(step);
    if (!years.has(salaryYear)) {
      years.set(salaryYear, {
        salary_year: salaryYear,
        start_date: `${String(salaryYear).padStart(4, "0")}-${String(normalizedStartMonth).padStart(2, "0")}-01`,
        steps: [],
        flags: [],
        final_amount_nok: null,
        change_nok: null,
        change_percent: null,
        inflation_percent: null,
        inflation_preliminary: false,
        real_change_percent: null,
        inflation_period: null,
        inflation_source: INFLATION_SOURCE,
      });
    }
    const bucket = years.get(salaryYear);
    bucket.steps.push(step);
    bucket.final_amount_nok = entry.amount_nok;
  }

  let previousAmount = null;
  const yearly = [...years.keys()]
    .sort((a, b) => a - b)
    .map((salaryYear) => {
      const bucket = years.get(salaryYear);
      const inflation = inflationForSalaryYear(salaryYear, normalizedStartMonth);
      bucket.flags = flagsByYear.get(salaryYear) || [];
      bucket.inflation_percent = inflation.inflation_percent;
      bucket.inflation_preliminary = inflation.inflation_preliminary;
      bucket.inflation_period = inflation.inflation_period;
      bucket.inflation_source = inflation.inflation_source;
      if (previousAmount && bucket.final_amount_nok) {
        bucket.change_nok = bucket.final_amount_nok - previousAmount;
        bucket.change_percent = roundPercent(((bucket.final_amount_nok - previousAmount) / previousAmount) * 100);
        if (bucket.inflation_percent !== null && bucket.inflation_percent !== undefined) {
          bucket.real_change_percent = roundPercent(bucket.change_percent - bucket.inflation_percent);
        }
      }
      previousAmount = bucket.final_amount_nok;
      return bucket;
    });

  return {
    salary_year_start_month: normalizedStartMonth,
    steps,
    yearly,
    predictions: buildPredictions(yearly),
    flags: sortedFlags,
  };
}
