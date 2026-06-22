#!/bin/bash
# ARX Dashboard — one-click push
# Run this any time you want to publish updates to zhangdailo.github.io/arx

cd "$(dirname "$0")"

echo "📦 Staging all changes..."
git add -A

echo "💾 Committing..."
git commit -m "update: dashboard + trader data $(date '+%Y-%m-%d %H:%M')" 2>&1 | grep -v "^$"

echo "🚀 Pushing to GitHub..."
git push

echo ""
echo "✅ Done! Live at: https://zhangdailo.github.io/arx"
echo "   (wait ~30s for GitHub Pages to refresh)"
