#!/bin/bash
set -e
echo "🧪 Running typecheck..."
if ! bun run typecheck; then
    echo "❌ Typecheck failed! Reverting to last commit..."
    git reset --hard HEAD~1
    echo "🔄 Retrying start..."
    exec bun run start
fi
echo "✅ Typecheck passed! Starting ForkScout..."
exec bun run start
