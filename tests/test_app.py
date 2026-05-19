import tempfile
import unittest
from pathlib import Path

from server import app


SAMPLE_TEXT = """Årslønn (heltid)
Gyldig fra\tGyldig til\tNY VERDI
2026-05-01\t
NOK 860000
2025-05-01\t2026-04-30
NOK 815000
2024-05-01\t2025-04-30
NOK 765000
2023-05-01\t2024-04-30
NOK 720000
2022-08-01\t2023-04-30
NOK 670000
2022-05-01\t2022-07-31
NOK 595000
2021-08-09\t2022-04-30
NOK 555000"""


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
        self.assertEqual(entries[0]["amount_nok"], 555000)
        self.assertEqual(entries[-1]["valid_from"], "2026-05-01")
        self.assertEqual(entries[-1]["valid_to"], None)
        self.assertEqual(entries[-1]["amount_nok"], 860000)

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
        self.assertEqual(yearly[2022]["final_amount_nok"], 670000)
        self.assertEqual(len(yearly[2022]["steps"]), 2)
        self.assertEqual(yearly[2023]["final_amount_nok"], 720000)
        self.assertEqual(yearly[2023]["change_nok"], 50000)
        self.assertEqual(yearly[2023]["change_percent"], 7.46)
        self.assertEqual(yearly[2023]["inflation_percent"], 2.98)
        self.assertEqual(yearly[2023]["real_change_percent"], 4.48)
        self.assertEqual(yearly[2023]["inflation_period"], "2023-05 til 2024-05")
        self.assertIn("SSB StatBank", yearly[2023]["inflation_source"])
        self.assertEqual(yearly[2025]["inflation_percent"], None)
        self.assertEqual(yearly[2025]["real_change_percent"], None)
        self.assertEqual(summary["predictions"]["average_change_percent"], 9.3)
        self.assertEqual(summary["predictions"]["based_on_years"], 5)
        self.assertEqual(summary["predictions"]["items"][0]["salary_year"], 2027)
        self.assertEqual(summary["predictions"]["items"][0]["predicted_amount_nok"], 939980)

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
        self.assertEqual(yearly[2022]["final_amount_nok"], 670000)
        self.assertEqual(yearly[2022]["change_percent"], 20.72)
        self.assertEqual(yearly[2022]["inflation_period"], "2022-01 til 2023-01")
        self.assertEqual(yearly[2022]["inflation_percent"], 7.02)
        self.assertEqual(yearly[2022]["real_change_percent"], 13.7)

    def test_inflation_for_salary_year_returns_none_when_end_month_is_missing(self):
        inflation = app.inflation_for_salary_year(2026, 5)

        self.assertEqual(inflation["inflation_period"], "2026-05 til 2027-05")
        self.assertEqual(inflation["inflation_percent"], None)


if __name__ == "__main__":
    unittest.main()
