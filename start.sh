#!/bin/bash
cd /home/openclaw/.openclaw/workspace/ollama-ui
gunicorn -w 1 -b 0.0.0.0:5000 --timeout 0 --access-logfile - --error-logfile - "app:create_app()"
