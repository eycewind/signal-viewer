#!/usr/bin/env bash
# Source this file to use the workspace-local Node and Python dependencies.
SIGNAL_VIEWER_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="${SIGNAL_VIEWER_ROOT}/.tools/node/bin:${PATH}"
export PYTHONPATH="${SIGNAL_VIEWER_ROOT}/.tools/python/site-packages${PYTHONPATH:+:${PYTHONPATH}}"
unset SIGNAL_VIEWER_ROOT
