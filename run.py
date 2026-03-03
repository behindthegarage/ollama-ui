#!/usr/bin/env python3
import os
import sys

# Add the app directory to the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import create_app

app = create_app()

if __name__ == '__main__':
    # Use gunicorn if available (production, no timeout)
    # Otherwise fall back to Flask dev server
    try:
        import gunicorn
        # Run with gunicorn: python run.py
        # Or directly: gunicorn -w 1 -b 0.0.0.0:5000 --timeout 0 "app:create_app()"
        os.system('gunicorn -w 1 -b 0.0.0.0:5000 --timeout 0 "app:create_app()"')
    except ImportError:
        # Fallback to Flask dev server
        app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
