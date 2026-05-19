import tempfile
import unittest
from pathlib import Path

from server import app
from server.inflation_data import CPI_INDEX_BY_MONTH, INFLATION_DATA_META


SAMPLE_TEXT = """Årslønn (heltid)
Gyldig fra\tGyldig til\tNY VERDI
2026-05-01\t
NOK 520000
2025-05-01\t2026-04-30
NOK 495000
2024-05-01\t2025-04-30
NOK 470000
2023-05-01\t2024-04-30
NOK 450000
2022-08-01\t2023-04-30
NOK 430000
2022-05-01\t2022-07-31
NOK 420000
2021-08-09\t2022-04-30
NOK 400000"""


class SalaryAppTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        app.DB_PATH = Path(self.tmpdir.name) / "salary.sqlite"
        app.init_db()

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_parse_salary_text(self):
        entries = app.parse_salary_text(SAMPLE_TEXT)

        self.assertEqual(len(entries), 7)
        self.assertEqual(entries[0]["valid_from"], "2021-08-09")
        self.assertEqual(entries[0]["amount_nok"], 400000)
        self.assertEqual(entries[-1]["valid_from"], "2026-05-01")
        self.assertEqual(entries[-1]["valid_to"], None)
        self.assertEqual(entries[-1]["amount_nok"], 520000)

    def test_parse_salary_text_supports_day_first_formats(self):
        entries = app.parse_salary_text(
            """02.05.2025 01052026
NOK 800000
2024-05-01 30-04-2025
760000
09082021 30042022
NOK 555000"""
        )

        self.assertEqual(len(entries), 3)
        self.assertEqual(entries[0]["valid_from"], "2021-08-09")
        self.assertEqual(entries[0]["valid_to"], "2022-04-30")
        self.assertEqual(entries[1]["valid_from"], "2024-05-01")
        self.assertEqual(entries[1]["valid_to"], "2025-04-30")
        self.assertEqual(entries[2]["valid_from"], "2025-05-02")
        self.assertEqual(entries[2]["valid_to"], "2026-05-01")

    def test_parse_salary_text_rejects_invalid_day_first_dates(self):
        with self.assertRaisesRegex(ValueError, "Ugyldig dato"):
            app.parse_salary_text("32.01.2024\nNOK 500000")

    def test_summary_groups_by_may_salary_year(self):
        entries = app.parse_salary_text(SAMPLE_TEXT)
        with app.connect() as db:
            timestamp = app.now_iso()
            for entry in entries:
                db.execute(
                    """
                    INSERT INTO salary_entries(valid_from, valid_to, amount_nok, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (entry["valid_from"], entry["valid_to"], entry["amount_nok"], timestamp, timestamp),
                )
            summary = app.build_summary(db)

        yearly = {item["salary_year"]: item for item in summary["yearly"]}
        self.assertEqual(summary["salary_year_start_month"], 5)
        self.assertEqual(yearly[2022]["final_amount_nok"], 430000)
        self.assertEqual(len(yearly[2022]["steps"]), 2)
        self.assertEqual(yearly[2023]["final_amount_nok"], 450000)
        self.assertEqual(yearly[2023]["change_nok"], 20000)
        self.assertEqual(yearly[2023]["change_percent"], 4.65)
        self.assertEqual(yearly[2023]["inflation_percent"], 2.98)
        self.assertEqual(yearly[2023]["real_change_percent"], 1.67)
        self.assertEqual(yearly[2023]["inflation_period"], "2023-05 til 2024-05")
        self.assertIn("SSB StatBank", yearly[2023]["inflation_source"])
        self.assertEqual(yearly[2025]["inflation_percent"], 2.9)
        self.assertEqual(yearly[2025]["inflation_preliminary"], True)
        self.assertEqual(yearly[2025]["inflation_period"], "2025-05 til 2026-04 (foreløpig, mål 2026-05)")
        self.assertEqual(yearly[2025]["real_change_percent"], 2.42)
        self.assertEqual(summary["dashboard"]["current_salary_nok"], 520000)
        self.assertEqual(summary["dashboard"]["total_nominal_growth_percent"], 30.0)
        self.assertEqual(summary["dashboard"]["cumulative_real_growth_percent"], 5.46)
        self.assertEqual(summary["dashboard"]["below_inflation_years_count"], 0)
        self.assertEqual(summary["dashboard"]["purchasing_power_adjustment_nok"], 0)
        self.assertEqual(summary["predictions"]["average_change_percent"], 5.39)
        self.assertEqual(summary["predictions"]["based_on_years"], 5)
        self.assertEqual(summary["predictions"]["items"][0]["salary_year"], 2027)
        self.assertEqual(summary["predictions"]["items"][0]["predicted_amount_nok"], 548028)

    def test_summary_recalculates_when_start_month_changes(self):
        entries = app.parse_salary_text(SAMPLE_TEXT)
        with app.connect() as db:
            timestamp = app.now_iso()
            db.execute(
                """
                INSERT INTO settings(key, value) VALUES ('salary_year_start_month', '1')
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """
            )
            for entry in entries:
                db.execute(
                    """
                    INSERT INTO salary_entries(valid_from, valid_to, amount_nok, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (entry["valid_from"], entry["valid_to"], entry["amount_nok"], timestamp, timestamp),
                )
            summary = app.build_summary(db)

        yearly = {item["salary_year"]: item for item in summary["yearly"]}
        self.assertEqual(summary["salary_year_start_month"], 1)
        self.assertEqual(yearly[2022]["final_amount_nok"], 430000)
        self.assertEqual(yearly[2022]["change_percent"], 7.5)
        self.assertEqual(yearly[2022]["inflation_period"], "2022-01 til 2023-01")
        self.assertEqual(yearly[2022]["inflation_percent"], 7.02)
        self.assertEqual(yearly[2022]["real_change_percent"], 0.48)
        self.assertEqual(summary["dashboard"]["cumulative_real_growth_percent"], 4.71)
        self.assertEqual(summary["dashboard"]["below_inflation_years_count"], 1)

    def test_inflation_for_salary_year_returns_none_when_end_month_is_missing(self):
        inflation = app.inflation_for_salary_year(2026, 5)

        self.assertEqual(inflation["inflation_period"], "2026-05 til 2027-05")
        self.assertEqual(inflation["inflation_percent"], None)
        self.assertEqual(inflation["inflation_preliminary"], False)

    def test_inflation_for_salary_year_returns_preliminary_when_only_full_end_month_is_missing(self):
        inflation = app.inflation_for_salary_year(2025, 5)

        self.assertEqual(inflation["inflation_period"], "2025-05 til 2026-04 (foreløpig, mål 2026-05)")
        self.assertEqual(inflation["inflation_percent"], 2.9)
        self.assertEqual(inflation["inflation_preliminary"], True)

    def test_embedded_ssb_cpi_data_includes_historical_and_latest_generated_coverage(self):
        months = sorted(CPI_INDEX_BY_MONTH)

        self.assertEqual(INFLATION_DATA_META["table"], "14709")
        self.assertEqual(INFLATION_DATA_META["base_period"], "2025=100")
        self.assertEqual(INFLATION_DATA_META["first_month"], "1920-03")
        self.assertEqual(INFLATION_DATA_META["latest_month"], months[-1])
        self.assertGreaterEqual(INFLATION_DATA_META["latest_month"], "2026-04")
        self.assertEqual(CPI_INDEX_BY_MONTH["1920-03"], 3.7)
        self.assertEqual(CPI_INDEX_BY_MONTH["2026-04"], 102.8)


if __name__ == "__main__":
    unittest.main()
