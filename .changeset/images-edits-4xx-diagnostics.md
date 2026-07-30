---
"@octafuse/proxy": patch
---

Improve Images `/v1/images/edits` client-error diagnostics: reject non-`multipart/form-data` Content-Type with an explicit message (instead of a misleading `Missing model`), and log structured `[Gateway Images] request rejected` fields (`contentType`, `bodyKeys`, `hasModel`, …) for all Images 4xx early exits. Proxy also logs truncated JSON bodies for Gateway-generated 4xx responses.
