#!/usr/bin/env bash
# NONCE solver kit setup for a GitHub Codespace (Ubuntu, 16-core recommended)
set -e
cd "$(dirname "$0")"
echo "== Installing tools =="
sudo apt-get update -qq && sudo apt-get install -y -qq build-essential git >/dev/null
npm install -g @binance/agentic-wallet@1.12.0 >/dev/null
npm init -y >/dev/null 2>&1 && npm install ethers@6 >/dev/null
echo "== Building kissat SAT solver =="
if [ ! -x ./kissat ]; then
  rm -rf kissat-src && git clone -q --depth 1 https://github.com/arminbiere/kissat kissat-src
  (cd kissat-src && ./configure --quiet >/dev/null && make -j"$(nproc)" >/dev/null) && cp kissat-src/build/kissat ./kissat
fi
echo "== Building probSAT local search =="
gcc -O3 -march=native -o probsat probsat.c -lm
echo "== Done. Cores available: $(nproc) =="
echo "Next: run  baw wallet status --json   (sign in with: baw auth signin --json, then baw auth verify --qrCodeId <id> --json)"
echo "Then:     node nonce.mjs"
