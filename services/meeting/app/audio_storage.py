import io
import logging
from datetime import datetime, timezone
from uuid import UUID

from minio import Minio
from minio.error import S3Error

from shared.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def _get_minio_client() -> Minio:
    """Create a MinIO client from settings."""
    return Minio(
        endpoint=settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=False,  # Local development uses HTTP
    )


def _ensure_bucket(client: Minio, bucket_name: str) -> None:
    """Ensure the target bucket exists, creating it if needed."""
    if not client.bucket_exists(bucket_name):
        client.make_bucket(bucket_name)
        logger.info(f"Created MinIO bucket: {bucket_name}")


async def upload_audio(meeting_id: UUID, audio_data: bytes) -> str:
    """Upload audio data to MinIO and return the storage key.

    Args:
        meeting_id: The meeting UUID to associate with the audio.
        audio_data: Raw audio bytes to store.

    Returns:
        The object storage key for later retrieval.
    """
    client = _get_minio_client()
    bucket = settings.minio_bucket
    _ensure_bucket(client, bucket)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    storage_key = f"meetings/{meeting_id}/{timestamp}.raw"

    data_stream = io.BytesIO(audio_data)
    data_length = len(audio_data)

    try:
        client.put_object(
            bucket_name=bucket,
            object_name=storage_key,
            data=data_stream,
            length=data_length,
            content_type="audio/raw",
        )
        logger.info(f"Uploaded audio for meeting {meeting_id}: {storage_key} ({data_length} bytes)")
        return storage_key
    except S3Error as e:
        logger.error(f"Failed to upload audio for meeting {meeting_id}: {e}")
        raise


async def download_audio(storage_key: str) -> bytes:
    """Download audio data from MinIO by storage key.

    Args:
        storage_key: The object key in MinIO.

    Returns:
        The raw audio bytes.
    """
    client = _get_minio_client()
    bucket = settings.minio_bucket

    try:
        response = client.get_object(bucket_name=bucket, object_name=storage_key)
        data = response.read()
        response.close()
        response.release_conn()
        logger.info(f"Downloaded audio: {storage_key} ({len(data)} bytes)")
        return data
    except S3Error as e:
        logger.error(f"Failed to download audio {storage_key}: {e}")
        raise


async def delete_audio(storage_key: str) -> None:
    """Delete audio data from MinIO.

    Args:
        storage_key: The object key in MinIO to delete.
    """
    client = _get_minio_client()
    bucket = settings.minio_bucket

    try:
        client.remove_object(bucket_name=bucket, object_name=storage_key)
        logger.info(f"Deleted audio: {storage_key}")
    except S3Error as e:
        logger.error(f"Failed to delete audio {storage_key}: {e}")
        raise
