import os
import requests
import uuid
from datetime import datetime
from flask import request, jsonify, current_app, render_template
from .config import OLLAMA_URL, MAX_FILE_SIZE
from .models import get_db_connection

# Base directory for projects
PROJECTS_DIR = "/home/openclaw/.openclaw/workspace/projects"

def register_routes(app):
    
    @app.route('/')
    def index():
        """Serve the main UI."""
        return render_template('index.html')
    @app.route('/api/health', methods=['GET'])
    def health_check():
        """Health check - also fetches Ollama models."""
        try:
            response = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
            if response.status_code == 200:
                models = response.json().get('models', [])
                return jsonify({
                    "status": "healthy",
                    "ollama_connected": True,
                    "models_count": len(models),
                    "models": models
                })
            else:
                return jsonify({
                    "status": "degraded",
                    "ollama_connected": False,
                    "error": f"Ollama returned status {response.status_code}"
                }), 503
        except requests.exceptions.RequestException as e:
            return jsonify({
                "status": "degraded",
                "ollama_connected": False,
                "error": str(e)
            }), 503
    
    @app.route('/api/models', methods=['GET'])
    def list_models():
        """List available models from Trantor."""
        try:
            response = requests.get(f"{OLLAMA_URL}/api/tags", timeout=10)
            response.raise_for_status()
            return jsonify(response.json())
        except requests.exceptions.RequestException as e:
            return jsonify({"error": f"Failed to fetch models: {str(e)}"}), 502
    
    @app.route('/api/chat', methods=['POST'])
    def chat():
        """Proxy to Ollama with file context injection."""
        try:
            data = request.get_json()
            if not data:
                return jsonify({"error": "Request body required"}), 400
            
            model = data.get('model')
            messages = data.get('messages', [])
            files = data.get('files', [])
            
            if not model:
                return jsonify({"error": "Model is required"}), 400
            if not messages:
                return jsonify({"error": "Messages are required"}), 400
            
            # Deep copy messages to avoid modifying the original
            import copy
            messages = copy.deepcopy(messages)
            
            # Inject file context into the first user message
            if files and len(messages) > 0:
                file_context = "You have access to the following files:\n"
                for file_item in files:
                    # Handle both file_id references and full file objects
                    if isinstance(file_item, str):
                        # Legacy: file_id reference
                        file_data = current_app.file_storage.get(file_item)
                        if file_data:
                            file_context += f"\n### File: {file_data['name']}\n{file_data['content']}\n"
                    elif isinstance(file_item, dict):
                        # New: full file object with content
                        file_name = file_item.get('name', 'unnamed')
                        file_content = file_item.get('content', '')
                        # Decode base64 if needed
                        try:
                            import base64
                            decoded = base64.b64decode(file_content).decode('utf-8', errors='replace')
                            file_content = decoded
                        except:
                            pass  # Use as-is if not base64
                        file_context += f"\n### File: {file_name}\n{file_content}\n"
                
                # Find first user message and prepend context
                for msg in messages:
                    if msg.get('role') == 'user':
                        msg['content'] = file_context + "\n" + msg['content']
                        break
            
            # Proxy to Ollama
            payload = {
                "model": model,
                "messages": messages,
                "stream": False
            }
            
            response = requests.post(
                f"{OLLAMA_URL}/api/chat",
                json=payload,
                timeout=None
            )
            response.raise_for_status()
            return jsonify(response.json())
            
        except requests.exceptions.RequestException as e:
            return jsonify({"error": f"Ollama request failed: {str(e)}"}), 502
        except Exception as e:
            return jsonify({"error": f"Unexpected error: {str(e)}"}), 500
    
    @app.route('/api/files', methods=['POST'])
    def upload_file():
        """Upload files - store in memory."""
        try:
            if 'file' not in request.files:
                return jsonify({"error": "No file provided"}), 400
            
            file = request.files['file']
            if file.filename == '':
                return jsonify({"error": "No file selected"}), 400
            
            content = file.read()
            size = len(content)
            
            if size > MAX_FILE_SIZE:
                return jsonify({"error": f"File too large. Max size: {MAX_FILE_SIZE / (1024*1024):.1f}MB"}), 413
            
            file_id = str(uuid.uuid4())
            
            # Store in app file_storage
            current_app.file_storage[file_id] = {
                "id": file_id,
                "name": file.filename,
                "size": size,
                "content": content.decode('utf-8', errors='replace')
            }
            
            return jsonify({
                "id": file_id,
                "name": file.filename,
                "size": size
            })
            
        except Exception as e:
            return jsonify({"error": f"Upload failed: {str(e)}"}), 500
    
    @app.route('/api/files/<file_id>', methods=['GET'])
    def get_file(file_id):
        """Get file content by id."""
        try:
            file_data = current_app.file_storage.get(file_id)
            if not file_data:
                return jsonify({"error": "File not found"}), 404
            
            return jsonify({
                "id": file_data['id'],
                "name": file_data['name'],
                "size": file_data['size'],
                "content": file_data['content']
            })
            
        except Exception as e:
            return jsonify({"error": f"Failed to retrieve file: {str(e)}"}), 500
    
    @app.route('/api/sessions', methods=['GET'])
    def list_sessions():
        """List all chat sessions."""
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, title, model, created_at, updated_at FROM sessions ORDER BY updated_at DESC"
            )
            rows = cursor.fetchall()
            conn.close()
            
            sessions = []
            for row in rows:
                sessions.append({
                    "id": row['id'],
                    "title": row['title'],
                    "model": row['model'],
                    "created_at": row['created_at'],
                    "updated_at": row['updated_at']
                })
            
            return jsonify({"sessions": sessions})
            
        except Exception as e:
            return jsonify({"error": f"Failed to fetch sessions: {str(e)}"}), 500
    
    @app.route('/api/sessions', methods=['POST'])
    def create_session():
        """Create a new chat session."""
        try:
            data = request.get_json()
            if not data:
                return jsonify({"error": "Request body required"}), 400
            
            title = data.get('title', 'New Chat')
            model = data.get('model', 'llama2')
            
            session_id = str(uuid.uuid4())
            now = datetime.now().isoformat()
            
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (session_id, title, model, now, now)
            )
            conn.commit()
            conn.close()
            
            return jsonify({
                "id": session_id,
                "title": title,
                "model": model,
                "created_at": now,
                "updated_at": now
            }), 201
            
        except Exception as e:
            return jsonify({"error": f"Failed to create session: {str(e)}"}), 500
    
    @app.route('/api/sessions/<session_id>', methods=['GET'])
    def get_session(session_id):
        """Get messages for a session."""
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            # Get session info
            cursor.execute(
                "SELECT id, title, model, created_at, updated_at FROM sessions WHERE id = ?",
                (session_id,)
            )
            session_row = cursor.fetchone()
            
            if not session_row:
                conn.close()
                return jsonify({"error": "Session not found"}), 404
            
            # Get messages
            cursor.execute(
                "SELECT id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC",
                (session_id,)
            )
            message_rows = cursor.fetchall()
            conn.close()
            
            messages = []
            for row in message_rows:
                messages.append({
                    "id": row['id'],
                    "role": row['role'],
                    "content": row['content'],
                    "created_at": row['created_at']
                })
            
            return jsonify({
                "session": {
                    "id": session_row['id'],
                    "title": session_row['title'],
                    "model": session_row['model'],
                    "created_at": session_row['created_at'],
                    "updated_at": session_row['updated_at']
                },
                "messages": messages
            })
            
        except Exception as e:
            return jsonify({"error": f"Failed to fetch session: {str(e)}"}), 500
    
    @app.route('/api/sessions/<session_id>/messages', methods=['POST'])
    def add_message(session_id):
        """Add a message to a session."""
        try:
            data = request.get_json()
            if not data:
                return jsonify({"error": "Request body required"}), 400
            
            role = data.get('role')
            content = data.get('content')
            
            if not role or not content:
                return jsonify({"error": "Role and content are required"}), 400
            
            if role not in ['user', 'assistant', 'system']:
                return jsonify({"error": "Role must be 'user', 'assistant', or 'system'"}), 400
            
            now = datetime.now().isoformat()
            
            conn = get_db_connection()
            cursor = conn.cursor()
            
            # Check if session exists
            cursor.execute("SELECT id FROM sessions WHERE id = ?", (session_id,))
            if not cursor.fetchone():
                conn.close()
                return jsonify({"error": "Session not found"}), 404
            
            # Insert message
            cursor.execute(
                "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
                (session_id, role, content, now)
            )
            message_id = cursor.lastrowid
            
            # Update session's updated_at
            cursor.execute(
                "UPDATE sessions SET updated_at = ? WHERE id = ?",
                (now, session_id)
            )
            
            conn.commit()
            conn.close()
            
            return jsonify({
                "id": message_id,
                "session_id": session_id,
                "role": role,
                "content": content,
                "created_at": now
            }), 201
            
        except Exception as e:
            return jsonify({"error": f"Failed to add message: {str(e)}"}), 500

    # ============ PROJECT ENDPOINTS ============
    
    @app.route('/api/projects', methods=['GET'])
    def list_projects():
        """List all project directories."""
        try:
            projects = []
            if os.path.exists(PROJECTS_DIR):
                for item in os.listdir(PROJECTS_DIR):
                    item_path = os.path.join(PROJECTS_DIR, item)
                    # Only include directories, skip hidden files
                    if os.path.isdir(item_path) and not item.startswith('.'):
                        projects.append(item)
            
            return jsonify({"projects": sorted(projects)})
            
        except Exception as e:
            return jsonify({"error": f"Failed to list projects: {str(e)}"}), 500

    @app.route('/api/projects/<name>/files', methods=['GET'])
    def list_project_files(name):
        """List all .md files in a project directory."""
        try:
            project_path = os.path.join(PROJECTS_DIR, name)
            
            # Security check: ensure path is within projects directory
            if not os.path.abspath(project_path).startswith(os.path.abspath(PROJECTS_DIR)):
                return jsonify({"error": "Invalid project name"}), 400
            
            if not os.path.exists(project_path) or not os.path.isdir(project_path):
                return jsonify({"error": "Project not found"}), 404
            
            md_files = []
            for item in os.listdir(project_path):
                if item.endswith('.md'):
                    md_files.append(item)
            
            # Sort files alphabetically
            md_files.sort()
            
            # Determine primary file
            primary_file = None
            if f"{name}.md" in md_files:
                primary_file = f"{name}.md"
            elif "README.md" in md_files:
                primary_file = "README.md"
            elif md_files:
                primary_file = md_files[0]
            
            # Build response
            files = []
            for filename in md_files:
                files.append({
                    "name": filename,
                    "path": os.path.join(project_path, filename),
                    "is_primary": filename == primary_file
                })
            
            return jsonify({"files": files})
            
        except Exception as e:
            return jsonify({"error": f"Failed to list project files: {str(e)}"}), 500

    @app.route('/api/projects/<name>/read', methods=['POST'])
    def read_project_file(name):
        """Read content of a specific file in a project."""
        try:
            data = request.get_json()
            if not data or 'file_path' not in data:
                return jsonify({"error": "file_path is required"}), 400
            
            file_path = data['file_path']
            
            # Security check: must be within projects directory and be a .md file
            abs_path = os.path.abspath(file_path)
            abs_projects_dir = os.path.abspath(PROJECTS_DIR)
            
            if not abs_path.startswith(abs_projects_dir):
                return jsonify({"error": "Access denied: file outside projects directory"}), 403
            
            if not file_path.endswith('.md'):
                return jsonify({"error": "Only .md files are allowed"}), 403
            
            if not os.path.exists(file_path) or not os.path.isfile(file_path):
                return jsonify({"error": "File not found"}), 404
            
            with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()
            
            return jsonify({
                "name": os.path.basename(file_path),
                "content": content
            })
            
        except Exception as e:
            return jsonify({"error": f"Failed to read file: {str(e)}"}), 500
