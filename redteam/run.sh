#!/bin/sh
# Generate attacks from promptfooconfig.yaml, run them against redteam-api, and keep
# the results: results/latest.json, results/latest.html, the generated tests, and
# results/summary.md, which keeps "not graded" apart from real policy breaks.
# The generated file stays next to provider.mjs, which it refers to by relative path.
# Promptfoo exits 100 when any test doesn't pass; the results are still written, so the
# summary always runs and the exit code is passed on afterwards.
set -e
npx promptfoo redteam generate -c promptfooconfig.yaml -o redteam.yaml --no-progress-bar
status=0
npx promptfoo redteam eval -c redteam.yaml -o results/latest.json results/latest.html --no-progress-bar -j 4 || status=$?
cp redteam.yaml results/redteam.yaml
node summarise.mjs
exit $status
