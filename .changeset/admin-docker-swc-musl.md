---
"@octafuse/admin": patch
---

Fix Admin Docker multi-arch build on `linux/arm64` (Alpine musl): explicitly install `@swc/core-linux-*-musl` after `npm ci --ignore-scripts`, so `next-intl` can load native SWC when evaluating `next.config` under buildx/QEMU.
