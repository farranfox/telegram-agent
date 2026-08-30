#!/bin/sh
set -eu
command="$(cat)"
exec sh -lc "$command"
