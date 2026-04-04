"""LIBERTASIAN Worker Service — S3/MinIO client for file downloads/uploads.

Celery tasks use this to download images for OCR and upload extracted text.
"""

import logging

import boto3
from botocore.config import Config as BotoConfig

from ..config import settings

logger = logging.getLogger(__name__)


def _get_s3_client():  # type: ignore[no-untyped-def]
    """Create a boto3 S3 client configured for MinIO/S3."""
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=BotoConfig(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
        ),
    )


def download_file(object_key: str, bucket: str | None = None) -> bytes:
    """Download a file from S3 and return its contents as bytes.

    Args:
        object_key: S3 object key path.
        bucket: S3 bucket name. Defaults to uploads bucket.

    Returns:
        File contents as bytes.

    Raises:
        Exception: If download fails.
    """
    bucket = bucket or settings.s3_bucket_uploads
    client = _get_s3_client()

    logger.info("Downloading s3://%s/%s", bucket, object_key)
    response = client.get_object(Bucket=bucket, Key=object_key)
    data: bytes = response["Body"].read()
    logger.info("Downloaded %d bytes from s3://%s/%s", len(data), bucket, object_key)
    return data


def upload_file(
    object_key: str,
    data: bytes,
    content_type: str = "text/plain",
    bucket: str | None = None,
) -> None:
    """Upload data to S3.

    Args:
        object_key: S3 object key path.
        data: File contents as bytes.
        content_type: MIME type for the uploaded file.
        bucket: S3 bucket name. Defaults to uploads bucket.
    """
    bucket = bucket or settings.s3_bucket_uploads
    client = _get_s3_client()

    logger.info("Uploading %d bytes to s3://%s/%s", len(data), bucket, object_key)
    client.put_object(
        Bucket=bucket,
        Key=object_key,
        Body=data,
        ContentType=content_type,
        ContentDisposition="attachment",
    )
    logger.info("Upload complete: s3://%s/%s", bucket, object_key)
