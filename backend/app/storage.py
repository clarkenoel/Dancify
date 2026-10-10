from __future__ import annotations

import asyncio
import os
import re
import shutil
import uuid
from pathlib import Path

import aiofiles
from fastapi import UploadFile


CHUNK_SIZE = 1024 * 1024
_SAFE_SUFFIX = re.compile(r"^\.[a-z0-9]{1,10}$")


class UploadTooLargeError(ValueError):
    pass


class EmptyUploadError(ValueError):
    pass


def safe_suffix(filename: str | None, default: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    return suffix if _SAFE_SUFFIX.fullmatch(suffix) else default


async def read_upload_limited(upload: UploadFile, max_bytes: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise UploadTooLargeError(f"Upload exceeds {max_bytes} bytes")
        chunks.append(chunk)
    if total == 0:
        raise EmptyUploadError("Upload must not be empty")
    return b"".join(chunks)


async def stage_upload(
    upload: UploadFile,
    directory: Path,
    *,
    prefix: str,
    suffix: str,
    max_bytes: int,
) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    staged = directory / f".{prefix}-{uuid.uuid4().hex}{suffix}.tmp"
    total = 0
    try:
        async with aiofiles.open(staged, "xb") as output:
            while True:
                chunk = await upload.read(CHUNK_SIZE)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise UploadTooLargeError(f"Upload exceeds {max_bytes} bytes")
                await output.write(chunk)
            if total == 0:
                raise EmptyUploadError("Upload must not be empty")
            await output.flush()
            await asyncio.to_thread(os.fsync, output.fileno())
        return staged
    except Exception:
        staged.unlink(missing_ok=True)
        raise


async def write_bytes_atomically(data: bytes, destination: Path) -> None:
    staged = destination.with_name(f".{destination.name}-{uuid.uuid4().hex}.tmp")
    try:
        async with aiofiles.open(staged, "xb") as output:
            await output.write(data)
            await output.flush()
            await asyncio.to_thread(os.fsync, output.fileno())
        os.replace(staged, destination)
    except Exception:
        staged.unlink(missing_ok=True)
        raise


def remove_path(path: Path | None) -> None:
    if path is None or not path.exists():
        return
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink()
