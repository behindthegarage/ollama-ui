# Ollama UI

A lightweight, file-aware chat interface for local LLM inference with Ollama.

![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)
![Flask](https://img.shields.io/badge/Flask-3.0+-green.svg)
![License](https://img.shields.io/badge/License-MIT-yellow.svg)

## Features

- 🚀 **Direct Ollama Integration** — Bypasses streaming limitations with `stream: false`
- 📁 **File Context Injection** — Upload files and include them in your prompts
- 💬 **Session Management** — Persistent chat history with SQLite
- 🎨 **Modern UI** — Dark theme, responsive design, drag-and-drop file upload
- 🤖 **Multi-Model Support** — Switch between all your Ollama models instantly

## Quick Start

### Prerequisites

- Python 3.8+
- [Ollama](https://ollama.com/) running locally or on your network

### Installation

```bash
git clone https://github.com/behindthegarage/ollama-ui.git
cd ollama-ui
pip install -r requirements.txt
```

### Configuration

Edit `app/config.py` to point to your Ollama instance:

```python
OLLAMA_URL = "http://localhost:11434"  # or your Ollama host
```

### Run

```bash
python run.py
```

Open http://localhost:5000 in your browser.

## Usage

1. **Select a model** from the dropdown
2. **Start chatting** — type your message and press Enter
3. **Attach files** — drag & drop files or click the attach button
4. **Files are injected** into the context automatically with your first message

## Architecture

```
Frontend (Vanilla JS)  →  Flask API  →  Ollama (/api/chat)
     ↓                          ↓
  Dark UI              SQLite Sessions
  Drag-drop            File Context Injection
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check + model list |
| `/api/models` | GET | List available Ollama models |
| `/api/chat` | POST | Send chat with optional file context |
| `/api/files` | POST | Upload a file |
| `/api/sessions` | GET/POST | List/create sessions |
| `/api/sessions/<id>` | GET | Get session messages |

## File Context Injection

When you attach files to a message, they're prepended to your prompt:

```
You have access to the following files:
### File: document.txt
[file content here]

[your actual message]
```

## Known Issues

### Vision Models

Not all vision models work via the HTTP API:

| Model | Vision Support | Notes |
|-------|---------------|-------|
| `llava:13b` | ✅ Working | Recommended for image analysis |
| `llava:34b` | ✅ Working | Larger version, more capable |
| `qwen3-vl:30b` | ❌ Not working | Works in Ollama desktop app but crashes via HTTP API |
| `gemma3:27b` | ⚠️ Untested | May work, needs verification |

**Recommendation:** Use `llava:13b` or `llava:34b` for image analysis.

### Model-Specific Timeouts (AMD/ROCm)

On AMD GPUs using ROCm (e.g., RX 9070 XT), some models may hit the 120s Ollama timeout:

| Model | Status | Notes |
|-------|--------|-------|
| `qwen3:30b` | ✅ Works | Fast, 256k context |
| `deepseek-r1:32b` | ✅ Works | Reasoning model |
| `qwen3.5:27b` | ⚠️ Timeout | Loads in ~12s but hangs during inference |
| `gemma3:27b` | ✅ Works | Multimodal, competitive speed |

**Workaround:** Use `qwen3:30b` or `deepseek-r1:32b` for heavy lifting instead of `qwen3.5:27b`.

## Known Issues

### Model-Specific Timeouts (AMD/ROCm)

Some models may timeout on AMD GPUs with ROCm/HIP:

| Model | Status | Notes |
|-------|--------|-------|
| `qwen3:30b` | ✅ Works | Fast, 256k context |
| `deepseek-r1:32b` | ✅ Works | Functional on RX 9070 XT |
| `gemma3:27b` | ✅ Works | Good alternative to qwen3.5 |
| `qwen3.5:27b` | ⚠️ Slow/Times out | MoE architecture issues on ROCm |

**Workaround:** Use `qwen3:30b` instead of `qwen3.5:27b` for similar parameter count with better performance.

### Timeout Configuration

The Flask backend has no request timeout (`timeout=None`). If you see 120s timeouts, they're likely coming from:
- Ollama server's default timeout (increase with `OLLAMA_KEEP_ALIVE`)
- Specific model performance issues (see above)

## Development

Built with:
- **Backend:** Flask, Flask-CORS, SQLite
- **Frontend:** Vanilla JavaScript (no frameworks)
- **Styling:** Custom CSS with CSS variables

## License

MIT

## Credits

Built by [BehindTheGarage](https://github.com/behindthegarage)
