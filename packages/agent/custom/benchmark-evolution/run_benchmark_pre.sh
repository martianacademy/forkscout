#!/bin/bash
cd "$(dirname "$0")"
node run_benchmark.js pre
if [ -f report_pre_*.json ]; then
  echo "Bench pre done: $(ls -t report_pre_*.json | head -1)"
else
  echo "Bench failed"
fi