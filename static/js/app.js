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
let projects = [];
let expandedProjects = new Set();
let loadedPrimaryFiles = new Set(); // Track which projects have had their primary file auto-loaded
let ollamaConnected = true; // Track Ollama connection status
let failedMessages = new Map(); // Store failed messages for retry

// Helper function to safely encode UTF-8 strings to base64
function utf8ToBase64(str) {
  const utf8Bytes = new TextEncoder().encode(str);
  let binary = '';
  utf8Bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary);
}

// Helper function to decode base64 to UTF-8 string
function base64ToUtf8(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

// DOM Elements
const elements = {
  sidebar: document.getElementById('sidebar'),
  overlayBackdrop: document.getElementById('overlayBackdrop'),
  newChatBtn: document.getElementById('newChatBtn'),
  sessionList: document.getElementById('sessionList'),
  emptySessions: document.getElementById('emptySessions'),
  projectList: document.getElementById('projectList'),
  emptyProjects: document.getElementById('emptyProjects'),
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
  dragOverlay: document.getElementById('dragOverlay'),
  connectionIndicator: document.getElementById('connectionIndicator'),
  retryConnectionBtn: document.getElementById('retryConnectionBtn')
};

// Initialize the app
document.addEventListener('DOMContentLoaded', init);

function init() {
  loadModels();
  setupEventListeners();
  loadSessions();
  loadProjects();
}

// API Functions
async function loadModels() {
  try {
    const response = await fetch('/api/models');
    if (!response.ok) throw new Error('Failed to load models');

    models = await response.json();
    populateModelSelector();
    setOllamaConnectionStatus(true);
  } catch (error) {
    console.error('Failed to load models:', error);
    setOllamaConnectionStatus(false);
    populateModelSelectorError();
  }
}

function setOllamaConnectionStatus(connected) {
  ollamaConnected = connected;
  const dot = elements.connectionIndicator.querySelector('.connection-dot');
  
  if (connected) {
    dot.classList.remove('disconnected');
    dot.classList.add('connected');
    elements.retryConnectionBtn.style.display = 'none';
    elements.modelSelect.disabled = false;
    elements.modelSelect.parentElement.classList.remove('error');
  } else {
    dot.classList.remove('connected');
    dot.classList.add('disconnected');
    elements.retryConnectionBtn.style.display = 'flex';
    elements.modelSelect.disabled = true;
    elements.modelSelect.parentElement.classList.add('error');
  }
}

function populateModelSelectorError() {
  elements.modelSelect.innerHTML = '<option value="" disabled selected>⚠️ Ollama unavailable</option>';
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
  try {
    const response = await fetch('/api/sessions');
    if (!response.ok) throw new Error('Failed to load sessions');

    const data = await response.json();
    sessions = data.sessions || [];
    renderSessionList();
  } catch (error) {
    console.error('Failed to load sessions:', error);
    sessions = [];
    renderSessionList();
  }
}

async function sendMessage(content, files, retryMessageId = null) {
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
    await createNewSession();
  }

  // Generate message ID for tracking
  const messageId = retryMessageId || 'msg_' + Date.now();

  // If this is a retry, remove the failed message UI
  if (retryMessageId) {
    const failedMsg = document.getElementById(retryMessageId);
    if (failedMsg) failedMsg.remove();
  }

  // Add user message to UI immediately
  const userMessage = { role: 'user', content, files: files.map(f => ({ name: f.name })) };
  currentSession.messages.push(userMessage);
  renderMessage(userMessage, messageId);
  scrollToBottom();

  // Save user message to database
  try {
    await fetch(`/api/sessions/${currentSession.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content })
    });
  } catch (error) {
    console.error('Failed to save user message:', error);
  }

  // Update session title from first user message if it's still default
  if (currentSession.messages.length === 1 && currentSession.title === 'New Conversation') {
    currentSession.title = content.slice(0, 30) + (content.length > 30 ? '...' : '');
    renderSessionList();
    // Update title in database
    try {
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: currentSession.title, model })
      });
    } catch (e) {
      // Silent fail - title update is not critical
    }
  }

  // Show loading indicator
  const loadingId = showLoadingIndicator();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: currentSession.messages.map(({files, ...msg}) => msg),  // Strip files property
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
    let assistantContent = '';
    if (data.message && data.message.content) {
      assistantContent = data.message.content;
    } else if (data.response) {
      assistantContent = data.response;
    } else if (data.content) {
      assistantContent = data.content;
    } else {
      assistantContent = JSON.stringify(data);
    }
    const assistantMessage = { role: 'assistant', content: assistantContent };
    currentSession.messages.push(assistantMessage);
    renderMessage(assistantMessage);
    scrollToBottom();

    // Save assistant message to database
    try {
      await fetch(`/api/sessions/${currentSession.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'assistant', content: assistantContent })
      });
    } catch (error) {
      console.error('Failed to save assistant message:', error);
    }

    // Clear failed message from tracking since it succeeded
    failedMessages.delete(messageId);

  } catch (error) {
    hideLoadingIndicator(loadingId);
    
    // Store the failed message for retry
    failedMessages.set(messageId, { content, files });
    
    // Mark the message as failed in the UI
    const messageEl = document.getElementById(messageId);
    if (messageEl) {
      messageEl.classList.add('failed');
      const contentDiv = messageEl.querySelector('.message-content');
      
      // Add retry action
      const errorActions = document.createElement('div');
      errorActions.className = 'message-error-actions';
      errorActions.innerHTML = `
        <span>${escapeHtml(getErrorMessage(error))}</span>
        <button class="retry-btn" onclick="retryMessage('${messageId}')">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          Retry
        </button>
      `;
      contentDiv.appendChild(errorActions);
    }
    
    // Update connection status if it looks like a connection error
    if (isConnectionError(error)) {
      setOllamaConnectionStatus(false);
    }
  } finally {
    isLoading = false;
    updateSendButton();
  }
}

function getErrorMessage(error) {
  const message = error.message || error.toString();
  
  if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
    return 'Request timed out. The model may be loading or the request took too long.';
  }
  if (message.includes('ECONNREFUSED') || message.includes('Failed to fetch')) {
    return 'Cannot connect to Ollama. Please check if Ollama is running.';
  }
  if (message.includes('network') || message.includes('NETWORK')) {
    return 'Network error. Please check your connection.';
  }
  if (message.includes('model') && message.includes('not found')) {
    return 'Model not found. Please select a different model.';
  }
  
  return 'Failed to send message: ' + message;
}

function isConnectionError(error) {
  const message = error.message || error.toString();
  return message.includes('ECONNREFUSED') || 
         message.includes('Failed to fetch') ||
         message.includes('timeout') ||
         message.includes('ETIMEDOUT') ||
         message.includes('network');
}

function retryMessage(messageId) {
  const failedMsg = failedMessages.get(messageId);
  if (failedMsg) {
    sendMessage(failedMsg.content, failedMsg.files, messageId);
  }
}

// UI Functions
async function createNewSession() {
  const model = elements.modelSelect.value || 'llama2';

  try {
    // Create session in database
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Conversation', model })
    });

    if (!response.ok) throw new Error('Failed to create session');

    const sessionData = await response.json();
    currentSessionId = sessionData.id;
    currentSession = {
      id: sessionData.id,
      title: sessionData.title,
      messages: [],
      createdAt: new Date(sessionData.created_at)
    };
    sessions.unshift(currentSession);
  } catch (error) {
    console.error('Failed to create session in DB, using local fallback:', error);
    // Fallback to local-only session
    currentSessionId = Date.now().toString();
    currentSession = {
      id: currentSessionId,
      title: 'New Conversation',
      messages: [],
      createdAt: new Date()
    };
    sessions.unshift(currentSession);
  }

  // Clear chat and show welcome
  elements.chatContainer.innerHTML = '';
  elements.chatContainer.appendChild(elements.welcomeScreen);
  elements.welcomeScreen.style.display = 'flex';

  elements.chatTitle.textContent = 'New Conversation';
  renderSessionList();

  // Close mobile sidebar
  closeSidebar();
}

async function loadSession(sessionId) {
  try {
    // Fetch session from database
    const response = await fetch(`/api/sessions/${sessionId}`);
    if (!response.ok) throw new Error('Failed to load session');

    const data = await response.json();
    const sessionData = data.session;
    const messages = data.messages || [];

    currentSessionId = sessionId;
    currentSession = {
      id: sessionData.id,
      title: sessionData.title,
      messages: messages,
      createdAt: new Date(sessionData.created_at)
    };

    // Hide welcome screen
    elements.welcomeScreen.style.display = 'none';

    // Clear and render messages
    elements.chatContainer.innerHTML = '';
    messages.forEach((msg, index) => {
      // Parse files from message if stored as JSON string
      if (msg.files && typeof msg.files === 'string') {
        try {
          msg.files = JSON.parse(msg.files);
        } catch (e) {
          msg.files = [];
        }
      }
      renderMessage(msg, 'loaded_msg_' + index);
    });

    elements.chatTitle.textContent = sessionData.title;
    renderSessionList();
    scrollToBottom();
    closeSidebar();
  } catch (error) {
    console.error('Failed to load session:', error);
    showError('Failed to load session: ' + error.message);
  }
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

// ============ PROJECT FUNCTIONS ============

async function loadProjects() {
  try {
    const response = await fetch('/api/projects');
    if (!response.ok) throw new Error('Failed to load projects');

    const data = await response.json();
    projects = data.projects || [];
    renderProjectsList();
  } catch (error) {
    console.error('Failed to load projects:', error);
    projects = [];
    renderProjectsList();
  }
}

function renderProjectsList() {
  elements.projectList.innerHTML = '';

  if (projects.length === 0) {
    elements.emptyProjects.style.display = 'block';
    return;
  }

  elements.emptyProjects.style.display = 'none';

  projects.forEach(projectName => {
    const li = document.createElement('li');
    li.className = 'project-item';
    li.dataset.projectName = projectName;

    const isExpanded = expandedProjects.has(projectName);
    const hasFiles = projects[projectName] && projects[projectName].files;

    li.innerHTML = `
      <div class="project-header ${isExpanded ? 'expanded' : ''}" onclick="toggleProject('${projectName}')">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="project-chevron">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="project-icon">
          <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
        </svg>
        <span class="project-name">${escapeHtml(projectName)}</span>
      </div>
      <ul class="project-files" id="project-files-${projectName}" style="display: ${isExpanded ? 'block' : 'none'};"></ul>
    `;

    elements.projectList.appendChild(li);

    // If already expanded and we have files, render them
    if (isExpanded && hasFiles) {
      renderProjectFiles(projectName, projects[projectName].files);
    }
  });
}

async function toggleProject(projectName) {
  const isExpanded = expandedProjects.has(projectName);
  const projectItem = elements.projectList.querySelector(`[data-project-name="${projectName}"]`);
  const filesList = document.getElementById(`project-files-${projectName}`);
  const header = projectItem.querySelector('.project-header');

  if (isExpanded) {
    // Collapse
    expandedProjects.delete(projectName);
    header.classList.remove('expanded');
    filesList.style.display = 'none';
  } else {
    // Expand
    expandedProjects.add(projectName);
    header.classList.add('expanded');
    filesList.style.display = 'block';

    // Load files if not already loaded
    if (!projects[projectName] || !projects[projectName].files) {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectName)}/files`);
        if (!response.ok) throw new Error('Failed to load project files');

        const data = await response.json();

        // Store files in projects object for caching
        if (!projects[projectName]) projects[projectName] = {};
        projects[projectName].files = data.files || [];

        renderProjectFiles(projectName, data.files);

        // Auto-add primary file if not already loaded for this project
        const primaryFile = data.files.find(f => f.is_primary);
        if (primaryFile && !loadedPrimaryFiles.has(projectName)) {
          loadedPrimaryFiles.add(projectName);
          await addProjectFileToContext(projectName, primaryFile);
        }
      } catch (error) {
        console.error('Failed to load project files:', error);
        filesList.innerHTML = '<li class="project-file-item"><span class="project-file-name">Error loading files</span></li>';
      }
    }
  }
}

function renderProjectFiles(projectName, files) {
  const filesList = document.getElementById(`project-files-${projectName}`);
  filesList.innerHTML = '';

  if (files.length === 0) {
    filesList.innerHTML = '<li class="project-file-item"><span class="project-file-name">No .md files found</span></li>';
    return;
  }

  files.forEach(file => {
    const fileItem = document.createElement('li');
    fileItem.className = 'project-file-item';

    fileItem.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
      ${file.is_primary ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="primary-star"><path fill-rule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" clip-rule="evenodd" /></svg>` : ''}
      <span class="project-file-name">${escapeHtml(file.name)}</span>
      <button class="add-context-btn" onclick="addProjectFileToContext('${projectName}', {name: '${file.name}', path: '${file.path}', is_primary: ${file.is_primary}})" title="Add to context">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Add
      </button>
    `;

    filesList.appendChild(fileItem);
  });
}

async function addProjectFileToContext(projectName, file) {
  try {
    // Check if file is already attached
    const existingFile = attachedFiles.find(f => f.name === file.name && f.project === projectName);
    if (existingFile) {
      showError(`File "${file.name}" is already in context`);
      return;
    }

    const response = await fetch(`/api/projects/${encodeURIComponent(projectName)}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: file.path })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to read file');
    }

    const data = await response.json();

    // Add to attachedFiles
    attachedFiles.push({
      id: 'project_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      name: data.name,
      content: utf8ToBase64(data.content), // UTF-8 safe base64 encode
      project: projectName
    });

    renderFileAttachments();

    // Show success feedback
    showSuccess(`Added "${data.name}" to context`);

  } catch (error) {
    showError('Failed to add file: ' + error.message);
  }
}

function renderMessage(message, messageId = null) {
  // Hide welcome screen if visible
  elements.welcomeScreen.style.display = 'none';

  const messageEl = document.createElement('div');
  messageEl.className = `message ${message.role}`;
  if (messageId) {
    messageEl.id = messageId;
  }

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

function showSuccess(message) {
  const successEl = document.createElement('div');
  successEl.className = 'success-message';
  successEl.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
    ${escapeHtml(message)}
  `;
  document.body.appendChild(successEl);

  setTimeout(() => {
    successEl.remove();
  }, 3000);
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
        ${file.project ? 
          '<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />' :
          '<path stroke-linecap="round" stroke-linejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.122 2.122l7.81-7.81" />'
        }
      </svg>
      <span>${file.project ? file.project + '/' : ''}${escapeHtml(file.name)}</span>
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

  // Retry connection button
  if (elements.retryConnectionBtn) {
    elements.retryConnectionBtn.addEventListener('click', () => {
      loadModels();
    });
  }

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