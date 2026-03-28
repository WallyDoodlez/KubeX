#!/bin/bash
cd "$(git rev-parse --show-toplevel)"
claude -p "$(cat .squidsquad/fe/CLAUDE.md)"
