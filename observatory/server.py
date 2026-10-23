"""Loopback-first FastAPI app and SQLite storage."""

import csv
import io
import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .astro import instant, plan

WEB = Path(__file__).parent / "web"


class Target(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    name: str = Field(min_length=1, max_length=100)
    ra: float = Field(ge=0, lt=24)
    dec: float = Field(ge=-90, le=90)
    notes: str = Field(default="", max_length=3000)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        if not value.strip():
            raise ValueError("Enter a target name.")
        return value.strip()


class PlanInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    start: str
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    hours: int = Field(ge=1, le=12)
    min_alt: int = Field(ge=0, le=85)
    dark_only: bool = True
    target_ids: list[str] = Field(default_factory=list, max_length=200)

    @field_validator("start")
    @classmethod
    def valid_time(cls, value):
        return instant(value).isoformat().replace("+00:00", "Z")


class Session(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    settings: PlanInput


class Observation(BaseModel):
    target_id: str
    observed_at: str
    outcome: str = Field(pattern="^(observed|attempted|clouded)$")
    notes: str = Field(default="", max_length=5000)

    @field_validator("observed_at")
    @classmethod
    def valid_time(cls, value):
        return instant(value).isoformat().replace("+00:00", "Z")


def create_app(database: str | Path | None = None):
    path = Path(database or os.environ.get("OBSERVATORY_DB", "data/observatory.sqlite"))
    path.parent.mkdir(parents=True, exist_ok=True)
    app = FastAPI(title="Observatory Planner", version="0.1.0")
    app.add_middleware(
        TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"]
    )

    @contextmanager
    def db():
        connection = sqlite3.connect(path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    with db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS targets(id TEXT PRIMARY KEY,name TEXT NOT NULL,ra REAL NOT NULL,dec REAL NOT NULL,notes TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,title TEXT NOT NULL,plan TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS observations(id TEXT PRIMARY KEY,target_id TEXT REFERENCES targets(id) ON DELETE SET NULL,target_name TEXT NOT NULL,observed_at TEXT NOT NULL,outcome TEXT NOT NULL,notes TEXT NOT NULL);
        """)

    def target_rows():
        with db() as conn:
            return [
                dict(r)
                for r in conn.execute(
                    "SELECT * FROM targets ORDER BY name COLLATE NOCASE,id"
                )
            ]

    def calculate(settings):
        values = settings.model_dump()
        selected = values.pop("target_ids")
        targets = target_rows()
        if selected:
            available = {t["id"] for t in targets}
            if set(selected) - available:
                raise HTTPException(
                    422, "A selected target no longer exists. Refresh the target list."
                )
            targets = [t for t in targets if t["id"] in selected]
        return plan(targets, values)

    def uid():
        from uuid import uuid4

        return str(uuid4())

    @app.middleware("http")
    async def protect_origin(request: Request, call_next):
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin")
            if origin and origin.rstrip("/") != str(request.base_url).rstrip("/"):
                return Response("Cross-origin writes are disabled.", status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/config")
    def config():
        return {"mode": "sqlite", "version": "0.1.0"}

    @app.get("/api/targets")
    def targets():
        return target_rows()

    @app.post("/api/targets", status_code=201)
    def add_target(target: Target):
        row = {"id": uid(), **target.model_dump()}
        with db() as conn:
            if conn.execute("SELECT COUNT(*) FROM targets").fetchone()[0] >= 200:
                raise HTTPException(
                    409,
                    "The first release supports 200 targets. Export or remove unused targets.",
                )
            conn.execute("INSERT INTO targets VALUES(:id,:name,:ra,:dec,:notes)", row)
        return row

    @app.put("/api/targets/{target_id}")
    def edit_target(target_id: str, target: Target):
        row = {"id": target_id, **target.model_dump()}
        with db() as conn:
            if (
                conn.execute(
                    "UPDATE targets SET name=:name,ra=:ra,dec=:dec,notes=:notes WHERE id=:id",
                    row,
                ).rowcount
                != 1
            ):
                raise HTTPException(404, "Target not found.")
        return row

    @app.delete("/api/targets/{target_id}", status_code=204)
    def delete_target(target_id: str):
        with db() as conn:
            if (
                conn.execute("DELETE FROM targets WHERE id=?", (target_id,)).rowcount
                != 1
            ):
                raise HTTPException(404, "Target not found.")
        return Response(status_code=204)

    @app.post("/api/plan")
    def make_plan(settings: PlanInput):
        return calculate(settings)

    @app.get("/api/sessions")
    def sessions():
        with db() as conn:
            return [
                {**dict(r), "plan": json.loads(r["plan"])}
                for r in conn.execute(
                    "SELECT * FROM sessions ORDER BY rowid DESC LIMIT 200"
                )
            ]

    @app.post("/api/sessions", status_code=201)
    def save_session(session: Session):
        row = {
            "id": uid(),
            "title": session.title.strip(),
            "plan": calculate(session.settings),
        }
        if not row["title"]:
            raise HTTPException(422, "Enter a session title.")
        with db() as conn:
            conn.execute(
                "INSERT INTO sessions VALUES(?,?,?)",
                (row["id"], row["title"], json.dumps(row["plan"])),
            )
        return row

    @app.get("/api/observations")
    def observations():
        with db() as conn:
            return [
                dict(r)
                for r in conn.execute(
                    "SELECT * FROM observations ORDER BY observed_at DESC,id DESC LIMIT 500"
                )
            ]

    @app.post("/api/observations", status_code=201)
    def add_observation(observation: Observation):
        with db() as conn:
            target = conn.execute(
                "SELECT name FROM targets WHERE id=?", (observation.target_id,)
            ).fetchone()
            if not target:
                raise HTTPException(404, "Target not found.")
            row = {
                "id": uid(),
                "target_name": target["name"],
                **observation.model_dump(),
            }
            conn.execute(
                "INSERT INTO observations VALUES(:id,:target_id,:target_name,:observed_at,:outcome,:notes)",
                row,
            )
        return row

    @app.delete("/api/observations/{observation_id}", status_code=204)
    def remove_observation(observation_id: str):
        with db() as conn:
            if (
                conn.execute(
                    "DELETE FROM observations WHERE id=?", (observation_id,)
                ).rowcount
                != 1
            ):
                raise HTTPException(404, "Observation not found.")
        return Response(status_code=204)

    @app.get("/api/export")
    def export_records():
        with db() as conn:
            return {
                "schema": 1,
                "targets": [dict(r) for r in conn.execute("SELECT * FROM targets")],
                "sessions": [
                    {**dict(r), "plan": json.loads(r["plan"])}
                    for r in conn.execute("SELECT * FROM sessions")
                ],
                "observations": [
                    dict(r) for r in conn.execute("SELECT * FROM observations")
                ],
            }

    @app.get("/api/export.csv")
    def export_csv():
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["target", "observed_at_utc", "outcome", "notes"])
        with db() as conn:
            for r in conn.execute("SELECT * FROM observations ORDER BY observed_at"):
                # Spreadsheet-safe user content.
                values = [r["target_name"], r["observed_at"], r["outcome"], r["notes"]]
                writer.writerow(
                    [
                        ("'" + v)
                        if str(v).startswith(("=", "+", "-", "@", "\t", "\r"))
                        else v
                        for v in values
                    ]
                )
        return Response(
            output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=observations.csv"},
        )

    app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
    return app
