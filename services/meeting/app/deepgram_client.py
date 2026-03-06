import asyncio
import json
import logging
from typing import AsyncIterator, Callable, Optional

import websockets

from shared.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

DEEPGRAM_WS_URL = "wss://api.deepgram.com/v1/listen"


class DeepgramStreamClient:
    """Async Deepgram WebSocket streaming client for real-time transcription.

    Connects to Deepgram's streaming API with multichannel, diarization,
    and Nova-3 model configuration. Implements async context manager pattern.
    """

    def __init__(
        self,
        on_transcript: Optional[Callable[[dict], None]] = None,
        language: str = "en",
    ):
        self._on_transcript = on_transcript
        self._language = language
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._receive_task: Optional[asyncio.Task] = None
        self._connected = False

    @property
    def is_connected(self) -> bool:
        return self._connected and self._ws is not None

    def _build_url(self) -> str:
        """Build the Deepgram WebSocket URL with query parameters."""
        params = {
            "model": "nova-3",
            "multichannel": "true",
            "channels": "2",
            "diarize": "true",
            "punctuate": "true",
            "utterances": "true",
            "interim_results": "true",
            "language": self._language,
            "encoding": "linear16",
            "sample_rate": "16000",
        }
        query_string = "&".join(f"{k}={v}" for k, v in params.items())
        return f"{DEEPGRAM_WS_URL}?{query_string}"

    async def connect(self) -> None:
        """Establish WebSocket connection to Deepgram."""
        url = self._build_url()
        headers = {
            "Authorization": f"Token {settings.deepgram_api_key}",
        }

        try:
            self._ws = await websockets.connect(
                url,
                additional_headers=headers,
                ping_interval=20,
                ping_timeout=10,
            )
            self._connected = True
            self._receive_task = asyncio.create_task(self._receive_loop())
            logger.info("Connected to Deepgram WebSocket")
        except Exception as e:
            logger.error(f"Failed to connect to Deepgram: {e}")
            self._connected = False
            raise

    async def _receive_loop(self) -> None:
        """Background task to receive and process Deepgram transcription results."""
        if self._ws is None:
            return

        try:
            async for message in self._ws:
                try:
                    data = json.loads(message)
                    if self._on_transcript:
                        self._on_transcript(data)
                except json.JSONDecodeError:
                    logger.warning("Received non-JSON message from Deepgram")
        except websockets.exceptions.ConnectionClosed as e:
            logger.info(f"Deepgram WebSocket connection closed: {e}")
        except Exception as e:
            logger.error(f"Error in Deepgram receive loop: {e}")
        finally:
            self._connected = False

    async def send_audio(self, audio_data: bytes) -> None:
        """Send an audio chunk to Deepgram for transcription."""
        if not self.is_connected or self._ws is None:
            raise RuntimeError("Not connected to Deepgram")
        try:
            await self._ws.send(audio_data)
        except websockets.exceptions.ConnectionClosed:
            self._connected = False
            raise

    async def close(self) -> None:
        """Gracefully close the Deepgram connection.

        Sends a close-stream message to signal end of audio,
        then closes the WebSocket.
        """
        if self._ws is not None:
            try:
                # Send Deepgram close-stream message
                close_msg = json.dumps({"type": "CloseStream"})
                await self._ws.send(close_msg)
                # Give Deepgram a moment to send final results
                await asyncio.sleep(0.5)
            except Exception:
                pass

            try:
                await self._ws.close()
            except Exception:
                pass
            finally:
                self._ws = None
                self._connected = False

        if self._receive_task is not None and not self._receive_task.done():
            self._receive_task.cancel()
            try:
                await self._receive_task
            except asyncio.CancelledError:
                pass
            self._receive_task = None

        logger.info("Deepgram WebSocket connection closed")

    async def __aenter__(self) -> "DeepgramStreamClient":
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        await self.close()
