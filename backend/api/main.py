from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

import redis.asyncio as aioredis

from backend.config import get_settings
from backend.core.camera_manager import CameraManager
from backend.models.schemas import CameraCreate, HomographyRequest, SlotUpdate
from backend.services.calibration import auto_detect_parking_slots
from backend.services.database import Database
from backend.services.auth_sessions import SessionStore
from backend.services.mailer import Mailer
from backend.services.migrations import run_migrations
from backend.services.portal_db import PortalDB


logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PKLOT_SAMPLE_PATH = Path(
    os.getenv("PKLOT_SAMPLE_PATH", PROJECT_ROOT / "sample-data/pklot/slots.json")
)

settings = get_settings()
database = Database(settings.database_url)
event_loop: asyncio.AbstractEventLoop | None = None


class WebSocketHub:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(websocket)

    async def broadcast(self, payload: dict[str, Any]) -> None:
        async with self._lock:
            connections = list(self._connections)
        if not connections:
            return

        results = await asyncio.gather(
            *(connection.send_json(payload) for connection in connections),
            return_exceptions=True,
        )
        stale = [
            connection
            for connection, result in zip(connections, results, strict=False)
            if isinstance(result, Exception)
        ]
        if stale:
            async with self._lock:
                for connection in stale:
                    self._connections.discard(connection)


websocket_hub = WebSocketHub()


async def persist_and_broadcast_change(
    camera_id: str,
    changed_slots: list[dict[str, Any]],
) -> None:
    for slot in changed_slots:
        await database.insert_event(camera_id, slot)

    await websocket_hub.broadcast(
        {
            "type": "occupancy_update",
            "camera_id": camera_id,
            "slots": changed_slots,
            "summary": camera_manager.list_cameras(),
        }
    )


def detector_change_callback(camera_id: str, changed_slots: list[dict[str, Any]]) -> None:
    if event_loop is None:
        return

    future = asyncio.run_coroutine_threadsafe(
        persist_and_broadcast_change(camera_id, changed_slots),
        event_loop,
    )

    def log_failure(done: asyncio.Future[Any]) -> None:
        try:
            done.result()
        except Exception:
            logger.exception("failed to persist/broadcast camera change")

    future.add_done_callback(log_failure)


camera_manager = CameraManager(
    model_path=os.getenv("MODEL_PATH", "yolov8m-obb.pt"),
    on_change=detector_change_callback,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global event_loop
    event_loop = asyncio.get_running_loop()
    await database.connect()

    if database.memory_mode:
        logger.warning(
            "memory mode: skipping migrations; portal endpoints will return 503"
        )
    else:
        await run_migrations(database.pool)

    # from_url is lazy — a down Redis must not block camera startup; failures
    # surface per-command and the portal deps translate them to 503s.
    redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
    portal_db = PortalDB(database)
    app.state.settings = settings
    app.state.db = database
    app.state.redis = redis_client
    app.state.sessions = SessionStore(redis_client, settings)
    app.state.portal_db = portal_db
    app.state.mailer = Mailer(settings, portal_db)

    if not settings.admin_configured:
        logger.warning("ADMIN_EMAIL/ADMIN_PASSWORD unset; admin portal login disabled")
    if not settings.smtp_configured:
        logger.info("SMTP not configured; outbound email will be captured in the outbox")

    for camera in await database.list_cameras():
        slots = await database.get_slots(camera["camera_id"])
        try:
            camera_manager.add_camera(
                camera_id=camera["camera_id"],
                rtsp_url=camera["rtsp_url"],
                name=camera.get("name") or camera["camera_id"],
                slots=slots,
                start=True,
            )
        except Exception:
            logger.exception("failed to start camera %s from database", camera["camera_id"])

    try:
        yield
    finally:
        camera_manager.stop_all()
        await redis_client.aclose()
        await database.close()
        event_loop = None


app = FastAPI(title="Sightline API", version="1.0.0", lifespan=lifespan)

# Bearer-token auth, no cookies — so credentials stay off and an explicit
# origin allowlist (dashboard + marketing/portal) replaces the old wildcard.
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    # Cloud hosts get random URL suffixes (e.g. *.onrender.com), so exact
    # origins can't be listed in config ahead of the first deploy.
    allow_origin_regex=os.getenv("CORS_ORIGIN_REGEX") or None,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
)

from backend.api.routers import admin as admin_router  # noqa: E402
from backend.api.routers import auth as auth_router  # noqa: E402
from backend.api.routers import public as public_router  # noqa: E402

app.include_router(auth_router.router)
app.include_router(admin_router.router)
app.include_router(public_router.router)


def _not_found(camera_id: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"camera '{camera_id}' not found")


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "database_mode": "memory" if database.memory_mode else "postgres",
        "cameras": len(camera_manager.list_cameras()),
    }


@app.post("/cameras")
async def add_camera(payload: CameraCreate) -> dict[str, Any]:
    name = payload.name or payload.camera_id

    await database.upsert_camera(payload.camera_id, payload.rtsp_url, name)

    # Only overwrite the stored slot list when the caller explicitly submits
    # one. Re-adding a camera, editing its metadata, or testing the RTSP URL
    # used to wipe every calibrated space because the frontend sends an empty
    # `slots: []`. Use POST /cameras/{id}/slots to update slots intentionally,
    # or DELETE /cameras/{id} to clear them.
    if payload.slots:
        slot_dicts = [slot.model_dump() for slot in payload.slots]
        stored_slots = await database.replace_slots(payload.camera_id, slot_dicts)
    else:
        stored_slots = await database.get_slots(payload.camera_id)

    worker = camera_manager.add_camera(
        camera_id=payload.camera_id,
        rtsp_url=payload.rtsp_url,
        name=name,
        slots=stored_slots,
        start=True,
    )

    await websocket_hub.broadcast(
        {
            "type": "full_state",
            "cameras": camera_manager.state(),
            "summary": camera_manager.list_cameras(),
        }
    )
    return {"camera": worker.summary(), "slots": worker.detector.get_slots()}


@app.delete("/cameras/{camera_id}")
async def delete_camera(camera_id: str) -> dict[str, Any]:
    removed = camera_manager.remove_camera(camera_id)
    db_removed = await database.delete_camera(camera_id)
    if not removed and not db_removed:
        raise _not_found(camera_id)

    await websocket_hub.broadcast(
        {
            "type": "full_state",
            "cameras": camera_manager.state(),
            "summary": camera_manager.list_cameras(),
        }
    )
    return {"deleted": camera_id}


@app.get("/cameras")
async def list_cameras() -> list[dict[str, Any]]:
    running = {camera["camera_id"]: camera for camera in camera_manager.list_cameras()}
    for camera in await database.list_cameras():
        slots = await database.get_slots(camera["camera_id"])
        running.setdefault(
            camera["camera_id"],
            {
                "camera_id": camera["camera_id"],
                "name": camera.get("name") or camera["camera_id"],
                "status": "stopped",
                "total": len(slots),
                "occupied": 0,
                "available": len(slots),
                "occupancy_pct": 0.0,
                "last_frame_at": None,
                "last_processed_at": None,
                "reconnect_attempts": 0,
                "last_error": None,
            },
        )
    return list(running.values())


@app.get("/cameras/{camera_id}/slots")
async def get_camera_slots(camera_id: str) -> list[dict[str, Any]]:
    slots = camera_manager.get_slots(camera_id)
    if slots is None:
        camera = await database.get_camera(camera_id)
        if camera is None:
            raise _not_found(camera_id)
        return await database.get_slots(camera_id)
    return slots


@app.get("/cameras/{camera_id}/detections")
async def get_camera_detections(camera_id: str) -> dict[str, Any]:
    worker = camera_manager.get_worker(camera_id)
    if worker is None:
        raise _not_found(camera_id)
    return {
        "camera_id": camera_id,
        "status": worker.status,
        "last_processed_at": worker.last_processed_at,
        "detections": worker.detector.last_detections,
    }


@app.post("/cameras/{camera_id}/slots")
async def update_camera_slots(camera_id: str, payload: SlotUpdate) -> list[dict[str, Any]]:
    slots = [slot.model_dump() for slot in payload.slots]
    updated = camera_manager.update_slots(camera_id, slots)
    if updated is None:
        camera = await database.get_camera(camera_id)
        if camera is None:
            raise _not_found(camera_id)
        updated = slots

    await database.replace_slots(camera_id, updated)
    await websocket_hub.broadcast(
        {
            "type": "full_state",
            "cameras": camera_manager.state(),
            "summary": camera_manager.list_cameras(),
        }
    )
    return updated


@app.post("/cameras/{camera_id}/samples/pklot")
async def load_pklot_sample(camera_id: str) -> dict[str, Any]:
    worker = camera_manager.get_worker(camera_id)
    if worker is None:
        raise _not_found(camera_id)
    if not PKLOT_SAMPLE_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                "PKLot sample slots were not found; run "
                "scripts/setup_pklot_sample.py first"
            ),
        )

    with PKLOT_SAMPLE_PATH.open(encoding="utf-8") as file:
        payload = json.load(file)

    sample_slots = payload.get("slots", [])
    slots = [
        {
            "slot_id": slot["slot_id"],
            "polygon": slot["polygon"],
        }
        for slot in sample_slots
    ]
    if not slots:
        raise HTTPException(status_code=422, detail="PKLot sample has no slots")

    updated = camera_manager.update_slots(camera_id, slots)
    if updated is None:
        raise _not_found(camera_id)

    await database.replace_slots(camera_id, updated)
    await websocket_hub.broadcast(
        {
            "type": "full_state",
            "cameras": camera_manager.state(),
            "summary": camera_manager.list_cameras(),
        }
    )

    expected = [
        {
            "slot_id": slot["slot_id"],
            "expected_occupied": bool(slot.get("expected_occupied", False)),
            "source_space_id": slot.get("source_space_id"),
        }
        for slot in sample_slots
    ]
    return {
        "camera_id": camera_id,
        "dataset": payload.get("dataset"),
        "source": payload.get("source"),
        "summary": payload.get("summary"),
        "slots": updated,
        "expected": expected,
    }


@app.post("/cameras/{camera_id}/calibrate")
async def calibrate_camera(camera_id: str) -> dict[str, Any]:
    worker = camera_manager.get_worker(camera_id)
    if worker is None:
        raise _not_found(camera_id)

    frame = worker.snapshot_for_calibration()
    if frame is None:
        raise HTTPException(
            status_code=409,
            detail="no frame available yet; wait for the camera to connect",
        )

    slots = await asyncio.to_thread(auto_detect_parking_slots, frame)
    return {"camera_id": camera_id, "slots": slots}


@app.post("/cameras/{camera_id}/homography")
async def set_camera_homography(
    camera_id: str,
    payload: HomographyRequest,
) -> dict[str, Any]:
    matrix = camera_manager.set_homography(
        camera_id,
        payload.src_points,
        payload.dst_points,
    )
    if matrix is None:
        raise _not_found(camera_id)
    return {"camera_id": camera_id, "homography_matrix": matrix}


async def mjpeg_frames(camera_id: str):
    boundary = b"--frame\r\n"
    while True:
        worker = camera_manager.get_worker(camera_id)
        if worker is None:
            break

        jpeg = await asyncio.to_thread(worker.latest_jpeg)
        if jpeg is None:
            await asyncio.sleep(0.15)
            continue

        yield (
            boundary
            + b"Content-Type: image/jpeg\r\n"
            + f"Content-Length: {len(jpeg)}\r\n\r\n".encode("ascii")
            + jpeg
            + b"\r\n"
        )
        await asyncio.sleep(0.05)


@app.get("/cameras/{camera_id}/stream")
async def camera_stream(camera_id: str) -> StreamingResponse:
    if camera_manager.get_worker(camera_id) is None:
        raise _not_found(camera_id)
    return StreamingResponse(
        mjpeg_frames(camera_id),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/summary")
async def summary() -> list[dict[str, Any]]:
    return camera_manager.list_cameras()


@app.get("/analytics/{camera_id}/history")
async def occupancy_history(
    camera_id: str,
    hours: int = Query(24, ge=1, le=24 * 31),
) -> list[dict[str, Any]]:
    if await database.get_camera(camera_id) is None and camera_manager.get_worker(camera_id) is None:
        raise _not_found(camera_id)
    return await database.history(camera_id, hours)


@app.get("/analytics/{camera_id}/peak-hours")
async def peak_hours(camera_id: str) -> list[dict[str, Any]]:
    if await database.get_camera(camera_id) is None and camera_manager.get_worker(camera_id) is None:
        raise _not_found(camera_id)
    return await database.peak_hours(camera_id)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket_hub.connect(websocket)
    try:
        await websocket.send_json(
            {
                "type": "full_state",
                "cameras": camera_manager.state(),
                "summary": camera_manager.list_cameras(),
            }
        )
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await websocket_hub.disconnect(websocket)
    except Exception:
        await websocket_hub.disconnect(websocket)
        raise
