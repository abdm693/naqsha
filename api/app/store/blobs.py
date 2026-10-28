"""Cloud Storage for images (concepts, renders, comment snapshots). Served back through /api/assets/{path}."""
from __future__ import annotations

import asyncio
import base64
import io
from functools import lru_cache

from google.cloud import storage

from .. import config


@lru_cache(maxsize=1)
def bucket() -> storage.Bucket:
    return storage.Client(project=config.PROJECT).bucket(config.BUCKET)


async def put(path: str, data: bytes, content_type: str = "image/png") -> str:
    def _up():
        b = bucket().blob(path)
        b.cache_control = "public, max-age=31536000, immutable"
        b.upload_from_string(data, content_type=content_type)
    await asyncio.to_thread(_up)
    return f"/api/assets/{path}"


async def get(path: str) -> tuple[bytes, str] | None:
    def _down():
        b = bucket().blob(path)
        if not b.exists():
            return None
        data = b.download_as_bytes()
        return data, b.content_type or "application/octet-stream"
    return await asyncio.to_thread(_down)


def _resize_webp(data: bytes, width: int) -> bytes:
    from PIL import Image
    im = Image.open(io.BytesIO(data))
    im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
    if im.width > width:
        im = im.resize((width, max(1, round(im.height * width / im.width))), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    im.save(out, "WEBP", quality=78, method=4)
    return out.getvalue()


async def thumb(path: str, width: int = 640) -> tuple[bytes, str] | None:
    """A WebP of a stored image at most `width` px wide, cached in the bucket next to the original (thumbs/w<width>/...)."""
    key = f"thumbs/w{width}/{path}.webp"
    got = await get(key)
    if got:
        return got
    src = await get(path)
    if not src or not src[1].startswith("image/"):
        return src
    data = await asyncio.to_thread(_resize_webp, src[0], width)
    await put(key, data, "image/webp")
    return data, "image/webp"


def decode_data_url(data_url: str) -> tuple[bytes, str]:
    head, _, b64 = data_url.partition(",")
    mime = head.split(":")[1].split(";")[0] if ":" in head else "image/png"
    return base64.b64decode(b64), mime
