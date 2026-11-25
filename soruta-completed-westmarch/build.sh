#!/usr/bin/env bash
# Reconstruit le bundle du module (JS + CSS). À LANCER AVANT CHAQUE PUBLICATION,
# car Foundry ne charge plus que dist/scwm.mjs et styles/_bundle.css
# (voir module.json). Le code source reste dans modules/ et styles/ pour l'édition.
set -e
cd "$(dirname "$0")"
npx --yes esbuild@0.25.5 index.js --bundle --format=esm --minify --legal-comments=none --outfile=dist/scwm.mjs
STYLES="westmarch-chat westmarch-character toolkit-character relations bestiary carnet tutoriel midi-range-fix connstats partypause playerlist casier pcstatus sceneaudio charvalidation gmnotes accessibility settings-hub chat-cards trade currency"
: > styles/_bundle.css
for s in $STYLES; do echo "/* ===== $s.css ===== */" >> styles/_bundle.css; cat "styles/$s.css" >> styles/_bundle.css; echo >> styles/_bundle.css; done
echo "Bundle reconstruit : dist/scwm.mjs + styles/_bundle.css"
