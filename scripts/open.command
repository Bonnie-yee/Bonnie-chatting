#!/bin/bash
REPLY_LAUNCH_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPLY_LAUNCH_DIR/.." || exit 1
exec /usr/local/bin/node "$REPLY_LAUNCH_DIR/launch.mjs"
