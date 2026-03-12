from flask import Flask
from flask_cors import CORS
import os
import threading
import time
from .models import init_db
from .config import OLLAMA_URL

def create_app():
    # Get the absolute path to the project directory
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    app = Flask(__name__, 
                template_folder=os.path.join(base_dir, 'templates'),
                static_folder=os.path.join(base_dir, 'static'))
    
    # Enable CORS for localhost development
    CORS(app, resources={
        r"/api/*": {
            "origins": ["http://localhost:*", "http://127.0.0.1:*"],
            "methods": ["GET", "POST", "OPTIONS"],
            "allow_headers": ["Content-Type"]
        }
    })
    
    # Initialize database
    init_db()
    
    # In-memory file storage
    app.file_storage = {}
    
    # Start periodic cleanup thread
    start_cleanup_thread(app)
    
    # Register routes
    from . import routes
    routes.register_routes(app)
    
    return app

def start_cleanup_thread(app):
    """Start a background thread for periodic file storage cleanup."""
    def cleanup_worker():
        from .routes import cleanup_file_storage
        with app.app_context():
            while True:
                try:
                    time.sleep(600)  # Sleep for 10 minutes
                    cleanup_file_storage()
                except Exception as e:
                    import sys
                    print(f"Cleanup thread error: {e}", file=sys.stderr)
    
    # Start cleanup thread as daemon so it exits with main thread
    cleanup_thread = threading.Thread(target=cleanup_worker, daemon=True)
    cleanup_thread.start()
    print("File storage cleanup thread started (runs every 10 minutes)")
