/**
 * Ollama UI - Main Application
 * A modern chat interface for Ollama
 */

// Global state
let currentSessionId = null;
let currentSession = null;
let models = [];
let attachedFiles = [];
let isLoading = false;
let sessions = [];

// DOM Elements
const elements = {
  sidebar: document.getElementById('sidebar'),
  overlayBackdrop: document.getElementById('overlayBackdrop'),
  newChatBtn: document.getElementById('newChatBtn'),
  sessionList: document.getElementById('sessionList'),
  emptySessions: document.getElementById('emptySessions'),
  mobileMenuBtn: document.getElementById('mobileMenuBtn'),
  chatTitle: document.getElementById('chatTitle'),
  modelSelect: document.getElementById('modelSelect'),
  chatContainer: document.getElementById('chatContainer'),
  welcomeScreen: document.getElementById('welcomeScreen'),
  inputContainer: document.getElementById('inputContainer'),
  fileAttachments: document.getElementById('fileAttachments'),
  messageInput: document.getElementById('messageInput'),
  sendBtn: document.getElementById('sendBtn'),
  attachBtn: document.getElementById('attachBtn'),
  fileInput: document.getElementById('fileInput'),
  dragOverlay: document.getElementById('dragOverlay')
};

// Initialize the app
document.addEventListener('DOMContentLoaded', init);

function init() {
  loadModels();
  setupEventListeners();
  loadSessions();
}

// API Functions
async function loadModels() {
  try {
    const response = await fetch('/api/models');
    if (!response.ok) throw new Error('Failed to load models');
    
    models = await response.json();
    populateModelSelector();
  } catch (error) {
    showError('Failed to load models: ' + error.message);
    elements.modelSelect.innerHTML = '<option value="" disabled>Error loading models</option>';
  }
}

function populateModelSelector() {
  elements.modelSelect.innerHTML = '<option value="" disabled selected>Select model...</option>';
  
  // Handle both {models: [...]} and direct array formats
  const modelList = models.models || models;
  
  modelList.forEach(model => {
    const option = document.createElement('option');
    option.value = model.name || model.id || model;
    option.textContent = model.name || model.id || model;
    elements.modelSelect.appendChild(option);
  });
}

async function loadSessions() {
  // Sessions are stored in memory for now
  // In a full implementation, this would fetch from the backend
  renderSessionList();
}

async function sendMessage(content, files) {
  if (isLoading) return;
  
  const model = elements.modelSelect.value;
  if (!model) {
    showError('Please select a model first');
    return;
  }

  isLoading = true;
  updateSendButton();
  
  // Create session if needed
  if (!currentSession) {
    createNewSession();
  }

  // Add user message to UI immediately
  const userMessage = { role: 'user', content, files: files.map(f => ({ name: f.name })) };
  currentSession.messages.push(userMessage);
  renderMessage(userMessage);
  scrollToBottom();

  // Show loading indicator
  const loadingId = showLoadingIndicator();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: currentSession.messages,
        files: files.map(f => ({ id: f.id, name: f.name, content: f.content }))
      })
    });

    hideLoadingIndicator(loadingId);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get response');
    }

    const data = await response.json();
    
    // Add assistant message - handle Ollama format {message: {role, content}}
    let content = '';
    if (data.message && data.message.content) {
      content = data.message.content;
    } else if (data.response) {
      content = data.response;
    } else if (data.content) {
      content = data.content;
    } else {
      content = JSON.stringify(data);
    }
    const assistantMessage = { role: 'assistant', content: content };
    currentSession.messages.push(assistantMessage);
    renderMessage(assistantMessage);
    scrollToBottom();
    
    // Update session title if first message
    if (currentSession.messages.length === 2) {
      currentSession.title = content.slice(0, 30) + (content.length > 30 ? '...' : '');
      renderSessionList();
    }

  } catch (error) {
    hideLoadingIndicator(loadingId);
    showError('Failed to send message: ' + error.message);
  } finally {
    isLoading = false;
    updateSendButton();
  }
}

// UI Functions
function createNewSession() {
  currentSessionId = Date.now().toString();
  currentSession = {
    id: currentSessionId,
    title: 'New Conversation',
    messages: [],
    createdAt: new Date()
  };
  sessions.unshift(currentSession);
  
  // Clear chat and show welcome
  elements.chatContainer.innerHTML = '';
  elements.chatContainer.appendChild(elements.welcomeScreen);
  elements.welcomeScreen.style.display = 'flex';
  
  elements.chatTitle.textContent = 'New Conversation';
  renderSessionList();
  
  // Close mobile sidebar
  closeSidebar();
}

function loadSession(sessionId) {
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return;
  
  currentSessionId = sessionId;
  currentSession = session;
  
  // Hide welcome screen
  elements.welcomeScreen.style.display = 'none';
  
  // Clear and render messages
  elements.chatContainer.innerHTML = '';
  session.messages.forEach(msg => renderMessage(msg));
  
  elements.chatTitle.textContent = session.title;
  renderSessionList();
  scrollToBottom();
  closeSidebar();
}

function renderSessionList() {
  elements.sessionList.innerHTML = '';
  
  if (sessions.length === 0) {
    elements.emptySessions.style.display = 'block';
    return;
  }
  
  elements.emptySessions.style.display = 'none';
  
  sessions.forEach(session => {
    const li = document.createElement('li');
    li.className = 'session-item' + (session.id === currentSessionId ? ' active' : '');
    li.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 9.75a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
      </svg>
      <span class="session-title">${escapeHtml(session.title)}</span>
    `;
    li.addEventListener('click', () => loadSession(session.id));
    elements.sessionList.appendChild(li);
  });
}

function renderMessage(message) {
  // Hide welcome screen if visible
  elements.welcomeScreen.style.display = 'none';
  
  const messageEl = document.createElement('div');
  messageEl.className = `message ${message.role}`;
  
  const avatar = message.role === 'user' ? 'U' : 'AI';
  const renderedContent = renderMarkdown(message.content);
  
  let filesHtml = '';
  if (message.files && message.files.length > 0) {
    filesHtml = `
      <div class="message-files">
        ${message.files.map(f => `
          <span class="message-file">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.122 2.122l7.81-7.81" />
            </svg>
            ${escapeHtml(f.name)}
          </span>
        `).join('')}
      </div>
    `;
  }
  
  messageEl.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-content">
      <div class="message-bubble">${renderedContent}</div>
      ${filesHtml}
    </div>
  `;
  
  elements.chatContainer.appendChild(messageEl);
}

function renderMarkdown(text) {
  if (!text) return '';
  
  // Escape HTML first
  let html = escapeHtml(text);
  
  // Code blocks
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  
  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
  
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  
  return html;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showLoadingIndicator() {
  const id = 'loading-' + Date.now();
  const loadingEl = document.createElement('div');
  loadingEl.id = id;
  loadingEl.className = 'message assistant';
  loadingEl.innerHTML = `
    <div class="message-avatar">AI</div>
    <div class="message-content">
      <div class="typing-indicator">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
    </div>
  `;
  elements.chatContainer.appendChild(loadingEl);
  scrollToBottom();
  return id;
}

function hideLoadingIndicator(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function showError(message) {
  const errorEl = document.createElement('div');
  errorEl.className = 'error-message';
  errorEl.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
    </svg>
    ${escapeHtml(message)}
  `;
  document.body.appendChild(errorEl);
  
  setTimeout(() => {
    errorEl.remove();
  }, 5000);
}

function updateSendButton() {
  elements.sendBtn.disabled = isLoading;
}

function scrollToBottom() {
  elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
}

// File Handling
function handleFiles(files) {
  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      attachedFiles.push({
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        name: file.name,
        content: e.target.result.split(',')[1] // base64 content
      });
      renderFileAttachments();
    };
    reader.readAsDataURL(file);
  });
}

function renderFileAttachments() {
  if (attachedFiles.length === 0) {
    elements.fileAttachments.style.display = 'none';
    elements.fileAttachments.innerHTML = '';
    return;
  }
  
  elements.fileAttachments.style.display = 'flex';
  elements.fileAttachments.innerHTML = attachedFiles.map((file, index) => `
    <div class="file-attachment">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.122 2.122l7.81-7.81" />
      </svg>
      <span>${escapeHtml(file.name)}</span>
      <button class="file-remove" data-index="${index}" title="Remove file">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  `).join('');
}

function removeFile(index) {
  attachedFiles.splice(index, 1);
  renderFileAttachments();
}

// Sidebar
function openSidebar() {
  elements.sidebar.classList.add('open');
  elements.overlayBackdrop.classList.add('active');
}

function closeSidebar() {
  elements.sidebar.classList.remove('open');
  elements.overlayBackdrop.classList.remove('active');
}

// Event Listeners
function setupEventListeners() {
  // New chat
  elements.newChatBtn.addEventListener('click', createNewSession);
  
  // Mobile menu
  elements.mobileMenuBtn.addEventListener('click', openSidebar);
  elements.overlayBackdrop.addEventListener('click', closeSidebar);
  
  // Send message
  elements.sendBtn.addEventListener('click', () => {
    const content = elements.messageInput.value.trim();
    if (!content && attachedFiles.length === 0) return;
    
    sendMessage(content, [...attachedFiles]);
    elements.messageInput.value = '';
    elements.messageInput.style.height = 'auto';
    attachedFiles = [];
    renderFileAttachments();
  });
  
  // Input handling
  elements.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      elements.sendBtn.click();
    }
  });
  
  // Auto-resize textarea
  elements.messageInput.addEventListener('input', () => {
    elements.messageInput.style.height = 'auto';
    elements.messageInput.style.height = Math.min(elements.messageInput.scrollHeight, 200) + 'px';
  });
  
  // File attachment
  elements.attachBtn.addEventListener('click', () => {
    elements.fileInput.click();
  });
  
  elements.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFiles(e.target.files);
      elements.fileInput.value = '';
    }
  });
  
  // File remove buttons (event delegation)
  elements.fileAttachments.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.file-remove');
    if (removeBtn) {
      const index = parseInt(removeBtn.dataset.index);
      removeFile(index);
    }
  });
  
  // Drag and drop
  let dragCounter = 0;
  
  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (e.dataTransfer.types.includes('Files')) {
      elements.dragOverlay.classList.add('active');
    }
  });
  
  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
      elements.dragOverlay.classList.remove('active');
    }
  });
  
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
  });
  
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    elements.dragOverlay.classList.remove('active');
    
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  });
}