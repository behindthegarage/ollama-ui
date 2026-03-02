from flask import Flask
from flask_cors import CORS
import os
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
    
    # Register routes
    from . import routes
    routes.register_routes(app)
    
    return app
