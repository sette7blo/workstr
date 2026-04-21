"""
modules/camera.py — Image(s) → exercise JSON via AI vision.
Accepts one or more images, sends in a single vision request,
extracts and saves a structured exercise. Lands in 'staged'.
"""
import base64
import json
import re
from pathlib import Path
from openai import OpenAI
from core import config
from core.db import db
from modules.importer import save_exercise_json, slugify
from modules.ai_generator import _generate_image

_SINGLE_PROMPT = """You are an exercise data extractor with computer vision.
The user will provide an image showing a fitness exercise — from a book, poster,
app screenshot, or handwritten notes. Extract the complete exercise and respond
ONLY with a valid JSON object. No preamble, no markdown fences — raw JSON only."""

_MULTI_PROMPT = """You are an exercise data extractor with computer vision.
The user will provide multiple images showing a fitness exercise from different angles
or pages. Combine all information into one complete exercise record.
Respond ONLY with a valid JSON object. No preamble, no markdown — raw JSON only."""

_FIELDS = """
Required fields:
- name: string
- slug: url-friendly lowercase with hyphens
- description: 1-3 sentences describing the exercise
- category: one of "strength", "cardio", "flexibility", "balance", "plyometrics"
- muscle_group: primary muscle group string
- muscles: array of targeted muscles
- equipment: array of required equipment (["Body Weight"] if none)
- difficulty: "beginner", "intermediate", or "advanced"
- tags: array of tags
- instructions: array of step strings
- default_sets: integer
- default_reps: string (e.g. "8-12" or "30 seconds")
- default_rest_sec: integer
- source_type: "camera"

If a field cannot be determined from the image, use "" or [] or sensible defaults.
Never invent information not visible in the images.
"""

_MIME = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def import_from_images(images: list[tuple[bytes, str]]) -> dict:
    """
    images: list of (image_bytes, filename) tuples
    Returns exercise dict. Raises on error.
    """
    if not images:
        raise ValueError("No images provided.")

    api_key = config.get("PPQ_API_KEY")
    if not api_key:
        raise ValueError("PPQ_API_KEY not configured. Add it in Settings.")

    base_url = config.get("PPQ_BASE_URL", "https://api.ppq.ai/v1")
    model = config.get("PPQ_VISION_MODEL", "gpt-4o")

    multi = len(images) > 1
    system = (_MULTI_PROMPT if multi else _SINGLE_PROMPT) + _FIELDS
    user_text = (
        "Extract the complete exercise from these images, combining all visible information."
        if multi else
        "Extract the exercise from this image."
    )

    content_blocks = []
    for img_bytes, filename in images:
        ext = Path(filename).suffix.lower()
        mime_type = _MIME.get(ext, "image/jpeg")
        b64 = base64.b64encode(img_bytes).decode("utf-8")
        content_blocks.append({
            "type": "image_url",
            "image_url": {"url": f"data:{mime_type};base64,{b64}", "detail": "high"},
        })
    content_blocks.append({"type": "text", "text": user_text})

    client = OpenAI(api_key=api_key, base_url=base_url)
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": content_blocks},
        ],
        max_tokens=1500,
        temperature=0.2,
    )

    content = response.choices[0].message.content.strip()
    content = re.sub(r"^```(?:json)?\s*", "", content)
    content = re.sub(r"\s*```$", "", content)

    data = json.loads(content)
    data["source_type"] = "camera"

    if "slug" not in data or not data["slug"]:
        data["slug"] = slugify(data.get("name", "exercise"))

    slug = data["slug"]
    image_model = config.get("PPQ_IMAGE_MODEL", "dall-e-3")
    image_path = _generate_image(data, slug, api_key, base_url, image_model)
    if image_path:
        data["image"] = f"images/{image_path.name}"

    save_exercise_json(data, status="staged")

    if image_path:
        with db() as conn:
            conn.execute(
                "UPDATE exercises SET image_url=?, updated_at=datetime('now') WHERE slug=?",
                (data["image"], slug)
            )

    return data
