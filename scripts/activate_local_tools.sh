#!/usr/bin/env bash
# Source this file to use the workspace-local Node and Python dependencies.
SIGNAL_VIEWER_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="${SIGNAL_VIEWER_ROOT}/.tools/python/bin:${SIGNAL_VIEWER_ROOT}/.tools/node/bin:${PATH}"
# Older versions of this script exported the local packages globally. Remove
# only that entry so Conda and other Python installations cannot import wheels
# built for the workspace's Python 3.12 interpreter.
SIGNAL_VIEWER_PACKAGE_PATH="${SIGNAL_VIEWER_ROOT}/.tools/python/site-packages"
if [[ -n "${PYTHONPATH:-}" ]]; then
  SIGNAL_VIEWER_CLEAN_PYTHONPATH=""
  IFS=':' read -ra SIGNAL_VIEWER_PYTHONPATH_PARTS <<< "${PYTHONPATH}"
  for SIGNAL_VIEWER_PATH_PART in "${SIGNAL_VIEWER_PYTHONPATH_PARTS[@]}"; do
    if [[ -n "${SIGNAL_VIEWER_PATH_PART}" && "${SIGNAL_VIEWER_PATH_PART}" != "${SIGNAL_VIEWER_PACKAGE_PATH}" ]]; then
      SIGNAL_VIEWER_CLEAN_PYTHONPATH="${SIGNAL_VIEWER_CLEAN_PYTHONPATH:+${SIGNAL_VIEWER_CLEAN_PYTHONPATH}:}${SIGNAL_VIEWER_PATH_PART}"
    fi
  done
  if [[ -n "${SIGNAL_VIEWER_CLEAN_PYTHONPATH}" ]]; then
    export PYTHONPATH="${SIGNAL_VIEWER_CLEAN_PYTHONPATH}"
  else
    unset PYTHONPATH
  fi
fi
hash -r
unset SIGNAL_VIEWER_ROOT SIGNAL_VIEWER_PACKAGE_PATH SIGNAL_VIEWER_CLEAN_PYTHONPATH SIGNAL_VIEWER_PYTHONPATH_PARTS SIGNAL_VIEWER_PATH_PART
