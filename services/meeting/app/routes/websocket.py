import asyncio
import json
import logging
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import verify_token
from shared.database import async_session
from shared.models import Meeting, Transcript, TranscriptUtterance
from shared.models.meeting import MeetingStatus

from ..audio_storage import upload_audio
from ..deepgram_client import DeepgramStreamClient

logger = logging.getLogger(__name__)
router = APIRouter(tags=["websocket"])

# Active meeting sessions: meeting_id -> set of connected frontend WebSockets
_meeting_viewers: dict[UUID, set[WebSocket]] = {}

# Active Deepgram sessions: meeting_id -> DeepgramStreamClient
_deepgram_sessions: dict[UUID, DeepgramStreamClient] = {}

# Audio buffers for saving to MinIO on disconnect
_audio_buffers: dict[UUID, bytearray] = {}

# Transcript IDs for active recordings: meeting_id -> transcript UUID
_active_transcripts: dict[UUID, UUID] = {}


async def _authenticate_websocket(websocket: WebSocket) -> dict:
    """Authenticate a WebSocket connection via token query param or first message."""
    token = websocket.query_params.get("token")
    if not token:
        # Try to get token from the first message
        try:
            first_msg = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
            data = json.loads(first_msg)
            token = data.get("token")
        except (asyncio.TimeoutError, json.JSONDecodeError):
            pass

    if not token:
        await websocket.close(code=4001, reason="Authentication required")
        raise WebSocketDisconnect(code=4001)

    try:
        return verify_token(token)
    except Exception:
        await websocket.close(code=4001, reason="Invalid token")
        raise WebSocketDisconnect(code=4001)


async def _broadcast_to_viewers(meeting_id: UUID, message: dict) -> None:
    """Broadcast a message to all frontend viewers of a meeting."""
    viewers = _meeting_viewers.get(meeting_id, set())
    dead_viewers: set[WebSocket] = set()

    for viewer_ws in viewers:
        try:
            await viewer_ws.send_json(message)
        except Exception:
            dead_viewers.add(viewer_ws)

    # Remove dead connections
    for dead in dead_viewers:
        viewers.discard(dead)


async def _ensure_transcript(meeting_id: UUID) -> UUID:
    """Create a Transcript row for this meeting if one doesn't exist yet. Returns transcript ID."""
    if meeting_id in _active_transcripts:
        return _active_transcripts[meeting_id]

    async with async_session() as db:
        result = await db.execute(
            select(Transcript).where(Transcript.meeting_id == meeting_id)
        )
        existing = result.scalar_one_or_none()
        if existing:
            _active_transcripts[meeting_id] = existing.id
            return existing.id

        transcript = Transcript(meeting_id=meeting_id, full_text="", word_count=0)
        db.add(transcript)
        await db.commit()
        await db.refresh(transcript)
        _active_transcripts[meeting_id] = transcript.id
        logger.info(f"Created transcript row for meeting {meeting_id}: {transcript.id}")
        return transcript.id


async def _persist_utterance(meeting_id: UUID, data: dict) -> None:
    """Persist a final Deepgram utterance to the database."""
    try:
        channel = data.get("channel", {})
        alternatives = channel.get("alternatives", [])
        if not alternatives:
            return

        alt = alternatives[0]
        text = alt.get("transcript", "").strip()
        if not text:
            return

        is_final = data.get("is_final", False)
        if not is_final:
            return

        transcript_id = await _ensure_transcript(meeting_id)

        speaker_index = alt.get("words", [{}])[0].get("speaker", 0) if alt.get("words") else 0
        confidence = alt.get("confidence", 0.0)
        words = alt.get("words", [])
        start_time = data.get("start", 0.0)
        end_time = data.get("start", 0.0) + data.get("duration", 0.0)

        async with async_session() as db:
            utterance = TranscriptUtterance(
                transcript_id=transcript_id,
                speaker_index=speaker_index,
                text=text,
                start_time=start_time,
                end_time=end_time,
                confidence=confidence,
                words_json=words if words else None,
            )
            db.add(utterance)
            await db.commit()
    except Exception as e:
        logger.error(f"Failed to persist utterance for meeting {meeting_id}: {e}")


async def _finalize_transcript(meeting_id: UUID) -> None:
    """Build full_text from all utterances and update the Transcript row."""
    transcript_id = _active_transcripts.pop(meeting_id, None)
    if not transcript_id:
        return

    try:
        async with async_session() as db:
            result = await db.execute(
                select(TranscriptUtterance)
                .where(TranscriptUtterance.transcript_id == transcript_id)
                .order_by(TranscriptUtterance.start_time)
            )
            utterances = result.scalars().all()

            if not utterances:
                return

            lines = []
            total_words = 0
            total_confidence = 0.0
            for u in utterances:
                speaker = u.speaker_name or f"Speaker {u.speaker_index}"
                lines.append(f"{speaker}: {u.text}")
                total_words += len(u.text.split())
                total_confidence += u.confidence

            full_text = "\n".join(lines)
            avg_confidence = total_confidence / len(utterances) if utterances else 0.0

            transcript_result = await db.execute(
                select(Transcript).where(Transcript.id == transcript_id)
            )
            transcript = transcript_result.scalar_one_or_none()
            if transcript:
                transcript.full_text = full_text
                transcript.word_count = total_words
                transcript.confidence_avg = avg_confidence
                await db.commit()
                logger.info(
                    f"Finalized transcript for meeting {meeting_id}: "
                    f"{len(utterances)} utterances, {total_words} words"
                )
    except Exception as e:
        logger.error(f"Failed to finalize transcript for meeting {meeting_id}: {e}")


async def _save_audio_buffer(meeting_id: UUID) -> None:
    """Save the accumulated audio buffer to MinIO."""
    buffer = _audio_buffers.pop(meeting_id, None)
    if buffer and len(buffer) > 0:
        try:
            storage_key = await upload_audio(meeting_id, bytes(buffer))
            # Update meeting record with storage key
            async with async_session() as db:
                result = await db.execute(
                    select(Meeting).where(Meeting.id == meeting_id)
                )
                meeting = result.scalar_one_or_none()
                if meeting:
                    meeting.audio_storage_key = storage_key
                    await db.commit()
            logger.info(f"Saved audio buffer for meeting {meeting_id}: {storage_key}")
        except Exception as e:
            logger.error(f"Failed to save audio for meeting {meeting_id}: {e}")


@router.websocket("/meetings/{meeting_id}/ws")
async def meeting_websocket(websocket: WebSocket, meeting_id: UUID):
    """WebSocket endpoint for meeting audio streaming and transcription relay.

    Flow:
    1. Client connects and authenticates via token
    2. Client sends a role message: {"role": "recorder"} or {"role": "viewer"}
    3. Recorder sends binary audio chunks -> forwarded to Deepgram
    4. Deepgram transcription results -> broadcast to all viewers
    5. On disconnect, audio buffer is saved to MinIO
    """
    await websocket.accept()

    # Authenticate
    user_payload = await _authenticate_websocket(websocket)
    user_id = UUID(user_payload["sub"])

    # Wait for role assignment
    try:
        role_msg = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
        role_data = json.loads(role_msg)
        role = role_data.get("role", "viewer")
    except (asyncio.TimeoutError, json.JSONDecodeError):
        role = "viewer"

    logger.info(f"WebSocket connected: meeting={meeting_id}, user={user_id}, role={role}")

    if role == "recorder":
        await _handle_recorder(websocket, meeting_id, user_id)
    else:
        await _handle_viewer(websocket, meeting_id, user_id)


async def _handle_recorder(websocket: WebSocket, meeting_id: UUID, user_id: UUID) -> None:
    """Handle the recording client's WebSocket connection.

    Receives audio chunks, forwards to Deepgram, and relays transcription
    results to all connected viewers.
    """
    # Initialize audio buffer
    _audio_buffers[meeting_id] = bytearray()

    # Also register recorder as a viewer to receive transcriptions
    if meeting_id not in _meeting_viewers:
        _meeting_viewers[meeting_id] = set()
    _meeting_viewers[meeting_id].add(websocket)

    # Callback for Deepgram transcription results
    def on_transcript(data: dict) -> None:
        loop = asyncio.get_event_loop()
        loop.call_soon_threadsafe(
            asyncio.create_task,
            _broadcast_to_viewers(meeting_id, {
                "type": "transcription",
                "data": data,
            }),
        )
        # Persist final utterances to the database
        if data.get("is_final", False):
            loop.call_soon_threadsafe(
                asyncio.create_task,
                _persist_utterance(meeting_id, data),
            )

    deepgram_client = DeepgramStreamClient(on_transcript=on_transcript)

    try:
        async with deepgram_client:
            _deepgram_sessions[meeting_id] = deepgram_client

            # Send confirmation to client
            await websocket.send_json({
                "type": "status",
                "data": {"status": "recording", "message": "Connected to transcription service"},
            })

            # Relay audio from client to Deepgram
            while True:
                message = await websocket.receive()

                if message.get("type") == "websocket.disconnect":
                    break

                if "bytes" in message and message["bytes"]:
                    audio_chunk = message["bytes"]
                    # Buffer audio for MinIO storage
                    _audio_buffers.get(meeting_id, bytearray()).extend(audio_chunk)
                    # Forward to Deepgram
                    await deepgram_client.send_audio(audio_chunk)

                elif "text" in message and message["text"]:
                    # Handle text control messages
                    try:
                        control = json.loads(message["text"])
                        if control.get("type") == "stop":
                            break
                    except json.JSONDecodeError:
                        pass

    except WebSocketDisconnect:
        logger.info(f"Recorder disconnected: meeting={meeting_id}")
    except Exception as e:
        logger.error(f"Recorder error for meeting {meeting_id}: {e}")
    finally:
        # Clean up
        _deepgram_sessions.pop(meeting_id, None)
        _meeting_viewers.get(meeting_id, set()).discard(websocket)

        # Finalize transcript (build full_text from utterances)
        await _finalize_transcript(meeting_id)

        # Save audio to MinIO
        await _save_audio_buffer(meeting_id)

        # Notify remaining viewers
        await _broadcast_to_viewers(meeting_id, {
            "type": "status",
            "data": {"status": "recording_stopped", "message": "Recording has ended"},
        })

        # Clean up viewer set if empty
        if meeting_id in _meeting_viewers and not _meeting_viewers[meeting_id]:
            del _meeting_viewers[meeting_id]


async def _handle_viewer(websocket: WebSocket, meeting_id: UUID, user_id: UUID) -> None:
    """Handle a frontend viewer's WebSocket connection.

    Viewer receives transcription results broadcast from the recorder session.
    """
    # Register as viewer
    if meeting_id not in _meeting_viewers:
        _meeting_viewers[meeting_id] = set()
    _meeting_viewers[meeting_id].add(websocket)

    # Send current status
    is_recording = meeting_id in _deepgram_sessions
    await websocket.send_json({
        "type": "status",
        "data": {
            "status": "recording" if is_recording else "waiting",
            "message": "Receiving live transcription" if is_recording else "Waiting for recording to start",
            "viewers_count": len(_meeting_viewers.get(meeting_id, set())),
        },
    })

    try:
        # Keep connection alive and handle any viewer messages
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            # Viewers can send ping messages to keep alive
            if "text" in message and message["text"]:
                try:
                    data = json.loads(message["text"])
                    if data.get("type") == "ping":
                        await websocket.send_json({"type": "pong"})
                except json.JSONDecodeError:
                    pass

    except WebSocketDisconnect:
        logger.info(f"Viewer disconnected: meeting={meeting_id}, user={user_id}")
    except Exception as e:
        logger.error(f"Viewer error for meeting {meeting_id}: {e}")
    finally:
        _meeting_viewers.get(meeting_id, set()).discard(websocket)
        if meeting_id in _meeting_viewers and not _meeting_viewers[meeting_id]:
            del _meeting_viewers[meeting_id]
