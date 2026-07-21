"""
OpenAI Vision adapter — uses the Responses API (POST /v1/responses), not
Chat Completions, because only Responses exposes the `reasoning.effort` knob.
Reasoning-capable models (gpt-5.6 series) think by default same as Gemini's
2.5+ "flash" models (see gemini_adapter.py) — an unbounded reasoning budget
adds seconds of latency a 1-2 sentence scene description doesn't need, so we
pin effort low and let it be tuned live via `openai_reasoning_effort`.
"""

import base64
import json
import urllib.request
import urllib.error

from .base import AIAdapter, AdapterError

_API_URL = "https://api.openai.com/v1/responses"

# Allowed reasoning.effort values (low -> high); "none" skips reasoning
# entirely on models that support it. Anything else falls back to "low".
_VALID_EFFORTS = {"none", "minimal", "low", "medium", "high", "xhigh"}


class OpenAIAdapter(AIAdapter):

    def _api_key(self) -> str:
        import os
        return os.environ.get("OPENAI_API_KEY") or self._cfg.OPENAI_API_KEY

    def _call(self, jpeg_bytes: bytes, prompt: str, max_tokens: int) -> str:
        key = self._api_key()
        if not key:
            raise AdapterError("openai_api_key not configured")

        model   = self._cfg.get("openai_model", "gpt-5.6-terra")
        effort  = str(self._cfg.get("openai_reasoning_effort", "low")).lower()
        if effort not in _VALID_EFFORTS:
            effort = "low"
        timeout = int(self._cfg.get("ai_timeout_s", 15))

        content: list = [{"type": "input_text", "text": prompt}]
        if jpeg_bytes:
            b64 = base64.b64encode(jpeg_bytes).decode()
            content.append({
                "type":      "input_image",
                "image_url": f"data:image/jpeg;base64,{b64}",
            })

        # The Responses API bills reasoning tokens against max_output_tokens, so
        # a tight cap can be fully consumed by reasoning — the response then
        # completes as status="incomplete" with only a reasoning item and no
        # message, and _extract_text raises. Add headroom whenever reasoning is
        # active so the visible answer (and the tiny test_connection reply) still
        # fits after the model finishes thinking.
        out_cap = max_tokens if effort in ("none", "minimal") else max_tokens + 512
        payload = {
            "model":             model,
            "input":             [{"role": "user", "content": content}],
            "max_output_tokens": out_cap,
            "reasoning":         {"effort": effort},
        }

        req = urllib.request.Request(
            _API_URL,
            data=json.dumps(payload).encode(),
            headers={
                "Content-Type":  "application/json",
                "Authorization": f"Bearer {key}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read())
            return _extract_text(data)
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")[:200]
            raise AdapterError(f"OpenAI HTTP {e.code}: {body}") from e
        except Exception as e:
            raise AdapterError(str(e)) from e

    def describe_scene(self, jpeg_bytes: bytes, prompt: str) -> str:
        return self._call(jpeg_bytes, prompt, max_tokens=220)

    def scan_qris(self, jpeg_bytes: bytes, prompt: str) -> str:
        return self._call(jpeg_bytes, prompt, max_tokens=120)

    def test_connection(self) -> dict:
        try:
            # Minimal text-only call, no image — cheaper and faster
            result = self._call(b"", "Reply with exactly one word: OK", max_tokens=16)
            return {"ok": True, "message": result}
        except AdapterError as e:
            return {"ok": False, "message": str(e)}
        except Exception as e:
            return {"ok": False, "message": f"Unexpected: {e}"}


def _extract_text(data: dict) -> str:
    """Pull the assistant's text out of a Responses API payload.

    `output` can list a reasoning summary item before the actual message item
    for reasoning-capable models, so find the message rather than assume
    output[0] is it.
    """
    for item in data.get("output", []):
        if item.get("type") == "message":
            for part in item.get("content", []):
                if part.get("type") == "output_text":
                    return (part.get("text") or "").strip()
    raise AdapterError(f"No output_text in OpenAI response: {json.dumps(data)[:200]}")
