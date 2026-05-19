from __future__ import annotations

import json
import os
import re
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .inflation_data import CPI_INDEX_BY_MONTH, INFLATION_DATA_META, INFLATION_SOURCE


DB_PATH = Path(os.environ.get("DB_PATH", "/data/salary.sqlite"))
STATIC_DIR = Path(os.environ.get("STATIC_DIR", Path(__file__).resolve().parent.parent / "dist"))
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8080"))
DEFAULT_SALARY_YEAR_START_MONTH = 5


@dataclass(frozen=True)
class SalaryEntry:
    id: int
    valid_from: str
    valid_to: str | None
    amount_nok: int


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS salary_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                valid_from TEXT NOT NULL UNIQUE,
                valid_to TEXT,
                amount_nok INTEGER NOT NULL CHECK (amount_nok > 0),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS year_flags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                salary_year INTEGER NOT NULL,
                label TEXT NOT NULL,
                note TEXT,
                color TEXT NOT NULL DEFAULT '#d97706',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )
        db.execute(
            """
            INSERT OR IGNORE INTO settings(key, value)
            VALUES ('salary_year_start_month', ?)
            """,
            (str(DEFAULT_SALARY_YEAR_START_MONTH),),
        )


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {key: row[key] for key in row.keys()}


def parse_iso_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"Ugyldig dato: {value}") from exc


def validate_salary_entry(payload: dict[str, Any]) -> tuple[str, str | None, int]:
    valid_from = str(payload.get("valid_from", "")).strip()
    valid_to_value = payload.get("valid_to")
    valid_to = str(valid_to_value).strip() if valid_to_value not in (None, "") else None
    amount_raw = payload.get("amount_nok")

    if not valid_from:
        raise ValueError("Gyldig fra mangler.")
    from_date = parse_iso_date(valid_from)
    to_date = parse_iso_date(valid_to) if valid_to else None
    if to_date and to_date < from_date:
        raise ValueError("Gyldig til kan ikke være før gyldig fra.")

    try:
        amount = int(amount_raw)
    except (TypeError, ValueError) as exc:
        raise ValueError("Årslønn må være et heltall.") from exc
    if amount <= 0:
        raise ValueError("Årslønn må være større enn 0.")

    return valid_from, valid_to, amount


def parse_salary_text(text: str) -> list[dict[str, Any]]:
    lines = [line.strip() for line in text.replace("\r", "\n").split("\n")]
    lines = [line for line in lines if line]
    entries: list[dict[str, Any]] = []

    date_pattern = re.compile(r"^(\d{4}-\d{2}-\d{2})(?:\s+(\d{4}-\d{2}-\d{2}))?$")
    amount_pattern = re.compile(r"^(?:NOK\s*)?([\d\s.,]+)$", re.IGNORECASE)

    index = 0
    while index < len(lines):
        date_match = date_pattern.match(lines[index])
        if not date_match:
            index += 1
            continue

        valid_from, valid_to = date_match.group(1), date_match.group(2)
        index += 1
        while index < len(lines):
            amount_match = amount_pattern.match(lines[index])
            if amount_match:
                amount_text = amount_match.group(1).replace(" ", "").replace(".", "").replace(",", "")
                entries.append(
                    {
                        "valid_from": valid_from,
                        "valid_to": valid_to,
                        "amount_nok": int(amount_text),
                    }
                )
                index += 1
                break
            if date_pattern.match(lines[index]):
                break
            index += 1

    if not entries:
        raise ValueError("Fant ingen lønnsrader i teksten.")

    return sorted(entries, key=lambda entry: entry["valid_from"])


def get_setting(db: sqlite3.Connection, key: str) -> str | None:
    row = db.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return str(row["value"]) if row else None


def get_salary_year_start_month(db: sqlite3.Connection) -> int:
    value = get_setting(db, "salary_year_start_month")
    try:
        month = int(value or DEFAULT_SALARY_YEAR_START_MONTH)
    except ValueError:
        month = DEFAULT_SALARY_YEAR_START_MONTH
    return month if 1 <= month <= 12 else DEFAULT_SALARY_YEAR_START_MONTH


def salary_year_for(valid_from: str, start_month: int) -> int:
    parsed = parse_iso_date(valid_from)
    return parsed.year if parsed.month >= start_month else parsed.year - 1


def month_key(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def inflation_for_salary_year(salary_year: int, start_month: int) -> dict[str, Any]:
    start_key = month_key(salary_year, start_month)
    end_key = month_key(salary_year + 1, start_month)
    start_index = CPI_INDEX_BY_MONTH.get(start_key)
    end_index = CPI_INDEX_BY_MONTH.get(end_key)
    latest_key = INFLATION_DATA_META.get("latest_month")
    latest_index = CPI_INDEX_BY_MONTH.get(latest_key) if latest_key else None
    has_preliminary_end = (
        start_index is not None
        and end_index is None
        and latest_key is not None
        and start_key < latest_key < end_key
        and latest_index is not None
    )
    comparison_end_key = latest_key if end_index is None and has_preliminary_end else end_key
    comparison_end_index = latest_index if end_index is None and has_preliminary_end else end_index
    inflation_percent = None
    if start_index is not None and comparison_end_index is not None:
        inflation_percent = round(((comparison_end_index - start_index) / start_index) * 100, 2)

    return {
        "inflation_period": (
            f"{start_key} til {comparison_end_key} (foreløpig, mål {end_key})" if has_preliminary_end else f"{start_key} til {end_key}"
        ),
        "inflation_source": INFLATION_SOURCE,
        "inflation_preliminary": has_preliminary_end,
        "inflation_percent": inflation_percent,
    }


def build_predictions(yearly: list[dict[str, Any]], years_ahead: int = 3) -> dict[str, Any]:
    changes = [
        float(year["change_percent"])
        for year in yearly
        if year.get("change_percent") is not None and year.get("final_amount_nok") is not None
    ]
    if not yearly or not changes:
        return {
            "method": "average_yearly_percent_change",
            "average_change_percent": None,
            "based_on_years": 0,
            "items": [],
        }

    average_change_percent = round(sum(changes) / len(changes), 2)
    growth_factor = 1 + (average_change_percent / 100)
    latest = yearly[-1]
    amount = int(latest["final_amount_nok"])
    predictions = []

    for offset in range(1, years_ahead + 1):
        amount = round(amount * growth_factor)
        predictions.append(
            {
                "salary_year": int(latest["salary_year"]) + offset,
                "predicted_amount_nok": amount,
                "predicted_change_percent": average_change_percent,
            }
        )

    return {
        "method": "average_yearly_percent_change",
        "average_change_percent": average_change_percent,
        "based_on_years": len(changes),
        "items": predictions,
    }


def build_summary(db: sqlite3.Connection) -> dict[str, Any]:
    start_month = get_salary_year_start_month(db)
    entries = [
        SalaryEntry(
            id=row["id"],
            valid_from=row["valid_from"],
            valid_to=row["valid_to"],
            amount_nok=row["amount_nok"],
        )
        for row in db.execute("SELECT * FROM salary_entries ORDER BY valid_from ASC, id ASC")
    ]
    flags_by_year: dict[int, list[dict[str, Any]]] = {}
    for row in db.execute("SELECT * FROM year_flags ORDER BY salary_year ASC, id ASC"):
        flags_by_year.setdefault(row["salary_year"], []).append(row_to_dict(row))

    years: dict[int, dict[str, Any]] = {}
    steps: list[dict[str, Any]] = []

    for entry in entries:
        salary_year = salary_year_for(entry.valid_from, start_month)
        step = {
            "id": entry.id,
            "valid_from": entry.valid_from,
            "valid_to": entry.valid_to,
            "amount_nok": entry.amount_nok,
            "salary_year": salary_year,
        }
        steps.append(step)
        year_bucket = years.setdefault(
            salary_year,
            {
                "salary_year": salary_year,
                "start_date": f"{salary_year:04d}-{start_month:02d}-01",
                "steps": [],
                "flags": [],
                "final_amount_nok": None,
                "change_nok": None,
                "change_percent": None,
                "inflation_percent": None,
                "inflation_preliminary": False,
                "real_change_percent": None,
                "inflation_period": None,
                "inflation_source": INFLATION_SOURCE,
            },
        )
        year_bucket["steps"].append(step)
        year_bucket["final_amount_nok"] = entry.amount_nok

    previous_amount: int | None = None
    yearly = []
    for salary_year in sorted(years):
        bucket = years[salary_year]
        final_amount = bucket["final_amount_nok"]
        inflation = inflation_for_salary_year(salary_year, start_month)
        bucket["flags"] = flags_by_year.get(salary_year, [])
        bucket["inflation_percent"] = inflation["inflation_percent"]
        bucket["inflation_preliminary"] = inflation["inflation_preliminary"]
        bucket["inflation_period"] = inflation["inflation_period"]
        bucket["inflation_source"] = inflation["inflation_source"]
        if previous_amount and final_amount:
            bucket["change_nok"] = final_amount - previous_amount
            bucket["change_percent"] = round(((final_amount - previous_amount) / previous_amount) * 100, 2)
            if bucket["inflation_percent"] is not None:
                bucket["real_change_percent"] = round(bucket["change_percent"] - bucket["inflation_percent"], 2)
        previous_amount = final_amount
        yearly.append(bucket)

    return {
        "salary_year_start_month": start_month,
        "steps": steps,
        "yearly": yearly,
        "predictions": build_predictions(yearly),
        "flags": [flag for flags in flags_by_year.values() for flag in flags],
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        try:
            if path == "/api/salary-entries":
                with connect() as db:
                    rows = db.execute("SELECT * FROM salary_entries ORDER BY valid_from ASC, id ASC").fetchall()
                    return self.send_json([row_to_dict(row) for row in rows])
            if path == "/api/year-flags":
                with connect() as db:
                    rows = db.execute("SELECT * FROM year_flags ORDER BY salary_year ASC, id ASC").fetchall()
                    return self.send_json([row_to_dict(row) for row in rows])
            if path == "/api/settings/salary-year-start-month":
                with connect() as db:
                    return self.send_json({"value": get_salary_year_start_month(db)})
            if path == "/api/summary":
                with connect() as db:
                    return self.send_json(build_summary(db))
            if path.startswith("/api/"):
                return self.send_error_json(HTTPStatus.NOT_FOUND, "Fant ikke API-endepunktet.")
            return self.serve_frontend()
        except ValueError as exc:
            return self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
        except sqlite3.IntegrityError as exc:
            return self.send_error_json(HTTPStatus.CONFLICT, f"Kunne ikke lagre: {exc}")

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            payload = self.read_json()
            if path == "/api/salary-entries":
                valid_from, valid_to, amount = validate_salary_entry(payload)
                timestamp = now_iso()
                with connect() as db:
                    cursor = db.execute(
                        """
                        INSERT INTO salary_entries(valid_from, valid_to, amount_nok, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (valid_from, valid_to, amount, timestamp, timestamp),
                    )
                    row = db.execute("SELECT * FROM salary_entries WHERE id = ?", (cursor.lastrowid,)).fetchone()
                    return self.send_json(row_to_dict(row), HTTPStatus.CREATED)
            if path == "/api/import-salary-text":
                text = str(payload.get("text", ""))
                parsed_entries = parse_salary_text(text)
                timestamp = now_iso()
                with connect() as db:
                    for entry in parsed_entries:
                        db.execute(
                            """
                            INSERT INTO salary_entries(valid_from, valid_to, amount_nok, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?)
                            ON CONFLICT(valid_from) DO UPDATE SET
                                valid_to = excluded.valid_to,
                                amount_nok = excluded.amount_nok,
                                updated_at = excluded.updated_at
                            """,
                            (
                                entry["valid_from"],
                                entry["valid_to"],
                                entry["amount_nok"],
                                timestamp,
                                timestamp,
                            ),
                        )
                    rows = db.execute("SELECT * FROM salary_entries ORDER BY valid_from ASC, id ASC").fetchall()
                    return self.send_json({"imported": len(parsed_entries), "entries": [row_to_dict(row) for row in rows]})
            if path == "/api/year-flags":
                salary_year = int(payload.get("salary_year"))
                label = str(payload.get("label", "")).strip()
                note = str(payload.get("note", "")).strip() or None
                color = str(payload.get("color", "#d97706")).strip() or "#d97706"
                if not label:
                    raise ValueError("Flagg må ha en etikett.")
                timestamp = now_iso()
                with connect() as db:
                    cursor = db.execute(
                        """
                        INSERT INTO year_flags(salary_year, label, note, color, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (salary_year, label, note, color, timestamp, timestamp),
                    )
                    row = db.execute("SELECT * FROM year_flags WHERE id = ?", (cursor.lastrowid,)).fetchone()
                    return self.send_json(row_to_dict(row), HTTPStatus.CREATED)
            return self.send_error_json(HTTPStatus.NOT_FOUND, "Fant ikke API-endepunktet.")
        except ValueError as exc:
            return self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
        except sqlite3.IntegrityError as exc:
            return self.send_error_json(HTTPStatus.CONFLICT, f"Kunne ikke lagre: {exc}")

    def do_PUT(self) -> None:
        path = urlparse(self.path).path
        try:
            payload = self.read_json()
            resource, item_id = self.parse_item_route(path)
            if path == "/api/settings/salary-year-start-month":
                month = int(payload.get("value"))
                if month < 1 or month > 12:
                    raise ValueError("Måned må være mellom 1 og 12.")
                with connect() as db:
                    db.execute(
                        """
                        INSERT INTO settings(key, value) VALUES ('salary_year_start_month', ?)
                        ON CONFLICT(key) DO UPDATE SET value = excluded.value
                        """,
                        (str(month),),
                    )
                    return self.send_json({"value": month})
            if resource == "salary-entries":
                valid_from, valid_to, amount = validate_salary_entry(payload)
                with connect() as db:
                    db.execute(
                        """
                        UPDATE salary_entries
                        SET valid_from = ?, valid_to = ?, amount_nok = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (valid_from, valid_to, amount, now_iso(), item_id),
                    )
                    row = db.execute("SELECT * FROM salary_entries WHERE id = ?", (item_id,)).fetchone()
                    if not row:
                        return self.send_error_json(HTTPStatus.NOT_FOUND, "Fant ikke lønnsraden.")
                    return self.send_json(row_to_dict(row))
            if resource == "year-flags":
                salary_year = int(payload.get("salary_year"))
                label = str(payload.get("label", "")).strip()
                note = str(payload.get("note", "")).strip() or None
                color = str(payload.get("color", "#d97706")).strip() or "#d97706"
                if not label:
                    raise ValueError("Flagg må ha en etikett.")
                with connect() as db:
                    db.execute(
                        """
                        UPDATE year_flags
                        SET salary_year = ?, label = ?, note = ?, color = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (salary_year, label, note, color, now_iso(), item_id),
                    )
                    row = db.execute("SELECT * FROM year_flags WHERE id = ?", (item_id,)).fetchone()
                    if not row:
                        return self.send_error_json(HTTPStatus.NOT_FOUND, "Fant ikke flagget.")
                    return self.send_json(row_to_dict(row))
            return self.send_error_json(HTTPStatus.NOT_FOUND, "Fant ikke API-endepunktet.")
        except ValueError as exc:
            return self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
        except sqlite3.IntegrityError as exc:
            return self.send_error_json(HTTPStatus.CONFLICT, f"Kunne ikke lagre: {exc}")

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path
        resource, item_id = self.parse_item_route(path)
        if not resource:
            return self.send_error_json(HTTPStatus.NOT_FOUND, "Fant ikke API-endepunktet.")
        table = "salary_entries" if resource == "salary-entries" else "year_flags"
        with connect() as db:
            cursor = db.execute(f"DELETE FROM {table} WHERE id = ?", (item_id,))
            if cursor.rowcount == 0:
                return self.send_error_json(HTTPStatus.NOT_FOUND, "Fant ikke raden.")
            return self.send_json({"deleted": True})

    def serve_frontend(self) -> None:
        requested = STATIC_DIR / self.path.lstrip("/")
        if self.path == "/" or not requested.exists():
            self.path = "/index.html"
        return super().do_GET()

    def parse_item_route(self, path: str) -> tuple[str | None, int | None]:
        match = re.match(r"^/api/(salary-entries|year-flags)/(\d+)$", path)
        if not match:
            return None, None
        return match.group(1), int(match.group(2))

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        body = self.rfile.read(length).decode("utf-8")
        return json.loads(body)

    def send_json(self, payload: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status: HTTPStatus, message: str) -> None:
        self.send_json({"error": message}, status)


def main() -> None:
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Server kjører på http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
