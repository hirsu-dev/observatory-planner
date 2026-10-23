import json
import math
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from fastapi.testclient import TestClient
from observatory.astro import horizontal, instant, plan
from observatory.server import create_app

ROOT = Path(__file__).resolve().parents[1]
SETTINGS = {
    "start": "2026-10-23T02:00:00Z",
    "latitude": 35,
    "longitude": -105,
    "hours": 6,
    "min_alt": 25,
    "dark_only": True,
}


class AstronomyTests(unittest.TestCase):
    def test_analytic_polar_altitudes(self):
        for lat in [-70, 0, 35, 90]:
            p = horizontal(4, 90, lat, 10, datetime(2026, 1, 1, tzinfo=timezone.utc))
            self.assertAlmostEqual(p["alt"], lat, places=5)

    def test_timezone_and_bounds(self):
        self.assertEqual(
            instant("2026-10-23T04:00:00+02:00"), instant(SETTINGS["start"])
        )
        for value in ["2026-10-23T01:00:00", "2010-01-01T00:00:00Z", "invalid"]:
            with self.assertRaises(ValueError):
                instant(value)

    def test_browser_and_python_plans_agree(self):
        target = {
            "id": "reference",
            "name": "Reference",
            "ra": 2.4,
            "dec": 62,
            "notes": "",
        }
        expected = plan([target], SETTINGS)
        script = (
            "import {plan} from './observatory/web/sky.js'; console.log(JSON.stringify(plan("
            + json.dumps([target])
            + ","
            + json.dumps(SETTINGS)
            + ")));"
        )
        actual = json.loads(
            subprocess.check_output(
                ["node", "--input-type=module", "-e", script], cwd=ROOT, text=True
            )
        )
        self.assertEqual(
            actual["targets"][0]["minutes"], expected["targets"][0]["minutes"]
        )
        self.assertEqual(actual["targets"][0]["score"], expected["targets"][0]["score"])
        for a, b in zip(
            actual["targets"][0]["samples"], expected["targets"][0]["samples"]
        ):
            self.assertAlmostEqual(a["alt"], b["alt"], places=4)
            self.assertAlmostEqual(a["sun_alt"], b["sun_alt"], places=4)

    def test_eligibility_and_interval_count(self):
        result = plan(
            [{"id": "south", "name": "South pole", "ra": 0, "dec": -90}], SETTINGS
        )["targets"][0]
        self.assertEqual(result["minutes"], 0)
        self.assertEqual(result["score"], 0)
        self.assertIsNone(result["best"])
        self.assertTrue(all(not s["eligible"] for s in result["samples"]))


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "test.db"
        self.client = TestClient(create_app(self.path))

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def target(self, name="Test target"):
        response = self.client.post(
            "/api/targets", json={"name": name, "ra": 2.4, "dec": 62, "notes": ""}
        )
        self.assertEqual(response.status_code, 201)
        return response.json()

    def test_target_session_journal_and_persistence(self):
        target = self.target()
        session = self.client.post(
            "/api/sessions", json={"title": "A sample night", "settings": SETTINGS}
        )
        self.assertEqual(session.status_code, 201)
        observation = self.client.post(
            "/api/observations",
            json={
                "target_id": target["id"],
                "observed_at": SETTINGS["start"],
                "outcome": "attempted",
                "notes": "Clouds",
            },
        )
        self.assertEqual(observation.status_code, 201)
        self.client.put(
            "/api/targets/" + target["id"],
            json={"name": "Renamed", "ra": 3, "dec": 62, "notes": "Changed"},
        )
        reopened = TestClient(create_app(self.path))
        self.assertEqual(reopened.get("/api/targets").json()[0]["name"], "Renamed")
        reopened.close()
        self.assertEqual(
            self.client.delete("/api/targets/" + target["id"]).status_code, 204
        )
        log = self.client.get("/api/observations").json()[0]
        self.assertIsNone(log["target_id"])
        self.assertEqual(log["target_name"], "Test target")
        self.assertEqual(
            self.client.get("/api/sessions").json()[0]["plan"]["targets"][0]["name"],
            "Test target",
        )
        self.assertEqual(len(self.client.get("/api/export").json()["observations"]), 1)

    def test_validation_missing_targets_and_cross_origin(self):
        self.assertEqual(
            self.client.post(
                "/api/targets", json={"name": " ", "ra": 24, "dec": 91}
            ).status_code,
            422,
        )
        self.assertEqual(
            self.client.post(
                "/api/plan", json={**SETTINGS, "start": "2026-10-23T02:00:00"}
            ).status_code,
            422,
        )
        self.assertEqual(
            self.client.post(
                "/api/plan", json={**SETTINGS, "target_ids": ["missing"]}
            ).status_code,
            422,
        )
        self.assertEqual(
            self.client.post(
                "/api/targets",
                headers={"Origin": "https://other.example"},
                json={"name": "x", "ra": 1, "dec": 1},
            ).status_code,
            403,
        )

    def test_export_is_spreadsheet_safe(self):
        target = self.target("=formula")
        self.client.post(
            "/api/observations",
            json={
                "target_id": target["id"],
                "observed_at": SETTINGS["start"],
                "outcome": "observed",
                "notes": "+SUM(A1:A2)",
            },
        )
        export = self.client.get("/api/export.csv")
        self.assertIn("'=formula", export.text)
        self.assertIn("'+SUM", export.text)

    def test_static_assets_and_error_routes(self):
        for url in ["/", "/app.js", "/style.css", "/sky.js"]:
            self.assertEqual(self.client.get(url).status_code, 200, url)
        self.assertEqual(self.client.delete("/api/targets/missing").status_code, 404)
        self.assertEqual(self.client.get("/api/config").json()["mode"], "sqlite")


if __name__ == "__main__":
    unittest.main()
