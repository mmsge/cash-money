import { buildSummary, DEFAULT_SALARY_YEAR_START_MONTH, parseSalaryText, validateSalaryEntry } from "./salaryCore.js";
import { sampleText } from "./sampleData.js";

const DEMO_STORAGE_KEY = "lonnsutvikling-demo-state-v1";
export const isDemoMode = import.meta.env?.VITE_DATA_MODE === "local";

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Ukjent feil");
  return payload;
}

function nextId(items) {
  return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

function seedDemoState() {
  return {
    salary_year_start_month: DEFAULT_SALARY_YEAR_START_MONTH,
    salary_entries: parseSalaryText(sampleText).map((entry, index) => ({ id: index + 1, ...entry })),
    year_flags: [],
  };
}

function readDemoState() {
  const stored = window.localStorage.getItem(DEMO_STORAGE_KEY);
  if (!stored) {
    const seeded = seedDemoState();
    writeDemoState(seeded);
    return seeded;
  }
  try {
    const parsed = JSON.parse(stored);
    return {
      salary_year_start_month: parsed.salary_year_start_month || DEFAULT_SALARY_YEAR_START_MONTH,
      salary_entries: parsed.salary_entries || [],
      year_flags: parsed.year_flags || [],
    };
  } catch {
    const seeded = seedDemoState();
    writeDemoState(seeded);
    return seeded;
  }
}

function writeDemoState(state) {
  window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
}

function validateFlag(payload) {
  const salaryYear = Number.parseInt(payload.salary_year, 10);
  const label = String(payload.label || "").trim();
  const note = String(payload.note || "").trim() || null;
  const color = String(payload.color || "#d97706").trim() || "#d97706";
  if (!Number.isInteger(salaryYear)) throw new Error("Lønnsår må være et heltall.");
  if (!label) throw new Error("Flagg må ha en etikett.");
  return { salary_year: salaryYear, label, note, color };
}

const apiService = {
  mode: "api",
  async getSummary() {
    return api("/api/summary");
  },
  async getSalaryEntries() {
    return api("/api/salary-entries");
  },
  async getYearFlags() {
    return api("/api/year-flags");
  },
  async saveSalaryEntry(id, payload) {
    if (id) return api(`/api/salary-entries/${id}`, { method: "PUT", body: JSON.stringify(payload) });
    return api("/api/salary-entries", { method: "POST", body: JSON.stringify(payload) });
  },
  async importSalaryText(text) {
    return api("/api/import-salary-text", { method: "POST", body: JSON.stringify({ text }) });
  },
  async saveYearFlag(id, payload) {
    if (id) return api(`/api/year-flags/${id}`, { method: "PUT", body: JSON.stringify(payload) });
    return api("/api/year-flags", { method: "POST", body: JSON.stringify(payload) });
  },
  async deleteSalaryEntry(id) {
    return api(`/api/salary-entries/${id}`, { method: "DELETE" });
  },
  async deleteYearFlag(id) {
    return api(`/api/year-flags/${id}`, { method: "DELETE" });
  },
  async updateStartMonth(value) {
    return api("/api/settings/salary-year-start-month", {
      method: "PUT",
      body: JSON.stringify({ value: Number(value) }),
    });
  },
};

const localService = {
  mode: "local",
  async getSummary() {
    const state = readDemoState();
    return buildSummary(state.salary_entries, state.year_flags, Number(state.salary_year_start_month));
  },
  async getSalaryEntries() {
    return readDemoState().salary_entries.sort((a, b) => a.valid_from.localeCompare(b.valid_from) || a.id - b.id);
  },
  async getYearFlags() {
    return readDemoState().year_flags.sort((a, b) => a.salary_year - b.salary_year || a.id - b.id);
  },
  async saveSalaryEntry(id, payload) {
    const state = readDemoState();
    const entry = validateSalaryEntry(payload);
    if (id) {
      const index = state.salary_entries.findIndex((item) => item.id === Number(id));
      if (index === -1) throw new Error("Fant ikke lønnsraden.");
      const duplicate = state.salary_entries.find((item) => item.id !== Number(id) && item.valid_from === entry.valid_from);
      if (duplicate) throw new Error("Kunne ikke lagre: UNIQUE constraint failed: salary_entries.valid_from");
      state.salary_entries[index] = { id: Number(id), ...entry };
    } else {
      const duplicate = state.salary_entries.find((item) => item.valid_from === entry.valid_from);
      if (duplicate) throw new Error("Kunne ikke lagre: UNIQUE constraint failed: salary_entries.valid_from");
      state.salary_entries.push({ id: nextId(state.salary_entries), ...entry });
    }
    writeDemoState(state);
    return entry;
  },
  async importSalaryText(text) {
    const state = readDemoState();
    const parsedEntries = parseSalaryText(text);
    for (const entry of parsedEntries) {
      const existing = state.salary_entries.find((item) => item.valid_from === entry.valid_from);
      if (existing) {
        Object.assign(existing, entry);
      } else {
        state.salary_entries.push({ id: nextId(state.salary_entries), ...entry });
      }
    }
    writeDemoState(state);
    return { imported: parsedEntries.length, entries: state.salary_entries };
  },
  async saveYearFlag(id, payload) {
    const state = readDemoState();
    const flag = validateFlag(payload);
    if (id) {
      const index = state.year_flags.findIndex((item) => item.id === Number(id));
      if (index === -1) throw new Error("Fant ikke flagget.");
      state.year_flags[index] = { id: Number(id), ...flag };
    } else {
      state.year_flags.push({ id: nextId(state.year_flags), ...flag });
    }
    writeDemoState(state);
    return flag;
  },
  async deleteSalaryEntry(id) {
    const state = readDemoState();
    const initialLength = state.salary_entries.length;
    state.salary_entries = state.salary_entries.filter((item) => item.id !== Number(id));
    if (state.salary_entries.length === initialLength) throw new Error("Fant ikke raden.");
    writeDemoState(state);
    return { deleted: true };
  },
  async deleteYearFlag(id) {
    const state = readDemoState();
    const initialLength = state.year_flags.length;
    state.year_flags = state.year_flags.filter((item) => item.id !== Number(id));
    if (state.year_flags.length === initialLength) throw new Error("Fant ikke raden.");
    writeDemoState(state);
    return { deleted: true };
  },
  async updateStartMonth(value) {
    const month = Number.parseInt(value, 10);
    if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error("Måned må være mellom 1 og 12.");
    const state = readDemoState();
    state.salary_year_start_month = month;
    writeDemoState(state);
    return { value: month };
  },
};

export const dataService = isDemoMode ? localService : apiService;
