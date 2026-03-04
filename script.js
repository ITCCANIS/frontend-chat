// ============================================================
// State
// ============================================================
let socket = null;
let currentChatReceiver = null;
let currentRoomId = null;
let currentUserId = null;
let allUsersData = [];
let unreadCounts = {};   // userId → count

// ============================================================
// Helpers — Avatar
// ============================================================
function getInitials(name) {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .map(w => w[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();
}

const AVATAR_COLORS = [
  '#667eea', '#764ba2', '#f093fb', '#f5576c',
  '#4facfe', '#43e97b', '#fa709a', '#fee140',
  '#30cfd0', '#667eea', '#a18cd1', '#fda085',
];
function getAvatarColor(name) {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ============================================================
// Helpers — Time
// ============================================================
function formatTime(date) {
  const d = date instanceof Date ? date : new Date();
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ============================================================
// Toast Notifications
// ============================================================
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-body">${message}</span>
    <button class="toast-dismiss" onclick="this.closest('.toast').remove()">×</button>
  `;
  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 260);
    }, duration);
  }
}

// ============================================================
// Settings Panel
// ============================================================
function toggleSettingsPanel() {
  const panel = document.getElementById('settingsPanel');
  const isOpen = panel.classList.toggle('open');
  panel.setAttribute('aria-hidden', !isOpen);

  // Pre-fill with saved key
  if (isOpen) {
    const saved = localStorage.getItem('apiKey');
    if (saved) {
      document.getElementById('apiKey').value = saved;
      setApiKeyStatus('Key saved', true);
    }
  }
}

function setApiKeyStatus(msg, success) {
  const el = document.getElementById('apiKeyStatus');
  el.textContent = msg;
  el.className = 'api-key-status ' + (success ? 'saved' : 'error');
}

function saveApiKey() {
  const val = document.getElementById('apiKey').value.trim();
  if (!val) {
    setApiKeyStatus('Please enter a key', false);
    return;
  }
  localStorage.setItem('apiKey', val);
  setApiKeyStatus('✓ API key saved', true);
  showToast('API key saved successfully', 'success', 3000);
  setTimeout(() => toggleSettingsPanel(), 900);
}

// ============================================================
// Socket Connection
// ============================================================
function connectToSocket() {
  const apiKey = localStorage.getItem('apiKey');
  const jwt    = localStorage.getItem('jwt');
  if (!apiKey || !jwt) return;

  socket = io('https://chatapp-backend-api-production.up.railway.app', {
    extraHeaders: { 'x-api-key': apiKey, authorization: jwt },
  });

  socket.on('connect', () => {
    console.log('Socket connected');
    socket.once('online:users', (data) => {
      updateOnlineUsersList(data);
    });
  });

  socket.on('presence:updated', () => {
    socket.once('online:users', (data) => {
      updateOnlineUsersList(data);
    });
  });

  socket.on('error', (error) => {
    console.error('Socket error:', error);
    showToast(error.message || 'A connection error occurred', 'error');
  });

  socket.on('message:received', (data) => {
    console.log('Received message:', data);

    if (data.type === 'group' && currentRoomId === data.receiverId) {
      addMessageToRoom(data.content, 'received', data.sender.username);
    } else if (data.type !== 'group') {
      if (currentChatReceiver && data.sender._id === currentChatReceiver.userId) {
        addMessageToUI(data.content, 'received', data.sender.username);
      } else {
        // Increment unread badge for this sender
        const senderId = data.sender._id;
        unreadCounts[senderId] = (unreadCounts[senderId] || 0) + 1;
        updateUnreadBadge(senderId);
        showToast(`New message from ${data.sender.username}`, 'info', 3500);
      }
    }
  });

  socket.on('message:sent', (data) => {
    console.log('Message sent:', data);
  });

  socket.on('room:joined', (data) => {
    console.log('Joined room:', data);
    currentRoomId = data.roomId;
    const el = document.querySelector(`[data-room-id="${data.roomId}"]`);
    if (el) {
      showRoomChat(el.getAttribute('data-room-name'), el.getAttribute('data-room-type'));
    } else {
      console.error('Room element not found:', data.roomId);
    }
  });

  socket.on('room:left', () => {
    hideRoomChat();
    currentRoomId = null;
  });
}

// ============================================================
// Rooms
// ============================================================
async function loadRooms() {
  const apiKey = localStorage.getItem('apiKey');
  const jwt    = localStorage.getItem('jwt');
  if (!apiKey || !jwt) return;

  try {
    const res = await fetch(
      'https://chatapp-backend-api-production.up.railway.app/api/getRooms',
      { headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey, Authorization: jwt } }
    );
    if (res.ok) {
      const data = await res.json();
      updateRoomsList(data.rooms);
    } else {
      showToast('Failed to load rooms', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('Failed to load rooms', 'error');
  }
}

function updateRoomsList(rooms) {
  const list = document.getElementById('roomsList');
  list.innerHTML = '<h4>Your Rooms</h4>';

  if (!rooms || rooms.length === 0) {
    list.innerHTML += `
      <div class="no-rooms-empty">
        <div class="empty-icon">🏠</div>
        <div>No rooms yet. Create one above!</div>
      </div>`;
    return;
  }

  rooms.forEach((room) => {
    const el = document.createElement('div');
    el.className = 'room-item';
    el.setAttribute('data-room-id', room._id);
    el.setAttribute('data-room-name', room.name);
    el.setAttribute('data-room-type', room.type || 'public');

    const initials  = getInitials(room.name);
    const color     = getAvatarColor(room.name);
    const typeLabel = (room.type === 'private') ? 'Private' : 'Public';
    const typeClass = (room.type === 'private') ? 'private' : 'public';

    el.innerHTML = `
      <div class="room-avatar" style="background:${color}">${initials}</div>
      <div class="room-info">
        <h5>${room.name}</h5>
        <div class="room-meta">
          <span class="room-type-badge ${typeClass}">${typeLabel}</span>
          <span>${room.members.length} member${room.members.length !== 1 ? 's' : ''}</span>
        </div>
      </div>`;
    el.addEventListener('click', () => joinRoom(room._id));
    list.appendChild(el);
  });
}

// ============================================================
// Users
// ============================================================
function updateOnlineUsersList(onlineUsers) {
  const onlineMap = new Map(onlineUsers.map(u => [u.userId || u._id, u]));

  let onlineCount = 0;
  document.querySelectorAll('.user-item').forEach((el) => {
    const uid = el.getAttribute('data-user-id');
    const dot = el.querySelector('.status-dot');
    const statusText = el.querySelector('.user-status-text');

    // Legacy hidden dot
    const legacyDot = el.querySelector('.user-status');
    if (legacyDot) {
      legacyDot.classList.toggle('status-online', onlineMap.has(uid) && uid !== currentUserId);
    }

    const isOnline = onlineMap.has(uid) && uid !== currentUserId;
    if (dot)        dot.classList.toggle('online', isOnline);
    if (statusText) {
      statusText.textContent = isOnline ? 'Online' : 'Offline';
      statusText.className   = 'user-status-text' + (isOnline ? ' online' : '');
    }
    el.classList.toggle('online', isOnline);
    if (isOnline) onlineCount++;
  });

  const countEl = document.getElementById('onlineCount');
  if (countEl) countEl.textContent = `${onlineCount} online`;
}

async function loadAllUsers() {
  const apiKey = localStorage.getItem('apiKey');
  const jwt    = localStorage.getItem('jwt');
  if (!apiKey || !jwt) return;

  try {
    const res = await fetch(
      'https://chatapp-backend-api-production.up.railway.app/api/getUsers',
      { headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey, Authorization: jwt } }
    );
    if (res.ok) {
      const data = await res.json();
      if (data.users && Array.isArray(data.users)) {
        allUsersData = data.users;
        updateUsersList(data.users);
      }
    }
  } catch (err) {
    console.error('Error loading users:', err);
  }
}

function updateUsersList(users) {
  const list = document.getElementById('usersList');
  list.innerHTML = '';

  if (!Array.isArray(users)) return;

  const filtered = users.filter(u => u._id !== currentUserId);

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="no-users-empty">
        <div class="empty-icon">👤</div>
        <div>No other users found</div>
      </div>`;
    return;
  }

  filtered.forEach((user) => {
    const el = document.createElement('div');
    el.className = 'user-item';
    el.setAttribute('data-user-id', user._id);

    const initials = getInitials(user.username || user.email || '?');
    const color    = getAvatarColor(user.username || user._id);
    const unread   = unreadCounts[user._id] || 0;

    el.innerHTML = `
      <div class="user-status"></div>
      <div class="user-avatar" style="background:${color}">
        ${initials}
        <span class="status-dot"></span>
      </div>
      <div class="user-info">
        <div class="user-name">${user.username || 'Unknown'}</div>
        <div class="user-status-text">Offline</div>
      </div>
      ${unread > 0 ? `<span class="unread-badge">${unread}</span>` : ''}`;

    el.addEventListener('click', () => openChatInterface(user));
    list.appendChild(el);
  });
}

function filterUsers(query) {
  const q = query.toLowerCase().trim();
  if (!q) {
    updateUsersList(allUsersData);
    return;
  }
  const filtered = allUsersData.filter(u =>
    (u.username && u.username.toLowerCase().includes(q)) ||
    (u.email    && u.email.toLowerCase().includes(q))
  );
  updateUsersList(filtered);
}

function updateUnreadBadge(userId) {
  const el = document.querySelector(`[data-user-id="${userId}"]`);
  if (!el) return;

  let badge = el.querySelector('.unread-badge');
  const count = unreadCounts[userId] || 0;

  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'unread-badge';
      el.appendChild(badge);
    }
    badge.textContent = count;
  } else if (badge) {
    badge.remove();
  }
}

// ============================================================
// Chat — Direct Messages
// ============================================================
async function openChatInterface(receiver) {
  currentChatReceiver = { ...receiver, userId: receiver.userId || receiver._id };

  // Clear unread for this user
  unreadCounts[receiver._id] = 0;
  updateUnreadBadge(receiver._id);

  // Header
  const name = receiver.username || 'User';
  document.getElementById('chatRecipient').textContent = name;

  const avatarEl = document.getElementById('chatRecipientAvatar');
  if (avatarEl) {
    avatarEl.textContent = getInitials(name);
    avatarEl.style.background = getAvatarColor(name);
  }

  document.getElementById('chatInterface').style.display = 'block';

  const container = document.getElementById('messagesContainer');
  container.innerHTML = '<div class="loading-messages">Loading messages…</div>';

  try {
    const messages = await loadMessageHistory({ senderId: currentUserId, receiverId: receiver._id });
    container.innerHTML = '';
    messages.reverse().forEach((msg) => {
      const isMine = msg.senderId._id === currentUserId;
      if (!isMine) addMessageToUI(msg.content, 'received', msg.senderId.username, new Date(msg.createdAt));
      else         addMessageToUI(msg.content, 'sent',     '',                   new Date(msg.createdAt));
    });
    container.scrollTop = container.scrollHeight;
  } catch (err) {
    console.error(err);
    showToast('Failed to load message history', 'error');
  }
}

function closeChatInterface() {
  document.getElementById('chatInterface').style.display = 'none';
  currentChatReceiver = null;
}

document.getElementById('messageForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentChatReceiver) return;

  const input   = document.getElementById('messageInput');
  const content = input.value.trim();
  if (!content) return;

  addMessageToUI(content, 'sent');
  socket.emit('message:private:send', { receiverId: currentChatReceiver.userId, content });
  input.value = '';
});

function addMessageToUI(content, type, senderName = '', date) {
  const container = document.getElementById('messagesContainer');
  const el = document.createElement('div');
  el.className = `message ${type}`;

  let html = '';
  if (type === 'received' && senderName) {
    html += `<span class="sender-name">${senderName}</span>`;
  }
  html += `<span class="message-content">${escapeHtml(content)}</span>`;
  html += `<span class="message-time">${formatTime(date)}</span>`;
  el.innerHTML = html;

  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

// ============================================================
// Chat — Room Messages
// ============================================================
function joinRoom(roomId) {
  if (socket) socket.emit('room:join', { roomId });
}

function leaveRoom() {
  if (currentRoomId && socket) socket.emit('room:leave', { roomId: currentRoomId });
}

async function showRoomChat(roomName, roomType) {
  document.getElementById('roomsList').style.display = 'none';
  document.getElementById('roomChatInterface').style.display = 'block';
  document.getElementById('currentRoomTitle').textContent = roomName;

  const avatarEl = document.getElementById('roomChatAvatar');
  if (avatarEl) {
    avatarEl.textContent = getInitials(roomName);
    avatarEl.style.background = getAvatarColor(roomName);
  }

  const container = document.getElementById('roomMessagesContainer');
  container.innerHTML = '<div class="loading-messages">Loading messages…</div>';

  try {
    const messages = await loadMessageHistory({ roomId: currentRoomId });
    container.innerHTML = '';
    messages.reverse().forEach((msg) => {
      const isMine = msg.senderId._id === currentUserId;
      addMessageToRoom(msg.content, isMine ? 'sent' : 'received', isMine ? '' : msg.senderId.username, new Date(msg.createdAt));
    });
    container.scrollTop = container.scrollHeight;
  } catch (err) {
    console.error(err);
    container.innerHTML = '<div class="error-message">Failed to load messages</div>';
  }
}

function hideRoomChat() {
  document.getElementById('roomsList').style.display = 'block';
  document.getElementById('roomChatInterface').style.display = 'none';
}

document.getElementById('roomMessageForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentRoomId) return;

  const input   = document.getElementById('roomMessageInput');
  const content = input.value.trim();
  if (!content) return;

  addMessageToRoom(content, 'sent');
  socket.emit('message:room:send', { roomId: currentRoomId, content });
  input.value = '';
});

function addMessageToRoom(content, type, senderName = '', date) {
  const container = document.getElementById('roomMessagesContainer');
  const el = document.createElement('div');
  el.className = `message ${type}`;

  let html = '';
  if (type === 'received' && senderName) {
    html += `<span class="sender-name">${senderName}</span>`;
  }
  html += `<span class="message-content">${escapeHtml(content)}</span>`;
  html += `<span class="message-time">${formatTime(date)}</span>`;
  el.innerHTML = html;

  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

// ============================================================
// Login
// ============================================================
function toggleLoginMode(mode) {
  const normal  = document.getElementById('loginForm');
  const first   = document.getElementById('firstLoginForm');
  const btns    = document.querySelectorAll('.toggle-btn');

  btns.forEach(b => b.classList.remove('active'));
  if (mode === 'normal') {
    normal.style.display = 'block';
    first.style.display  = 'none';
    btns[0].classList.add('active');
  } else {
    normal.style.display = 'none';
    first.style.display  = 'block';
    btns[1].classList.add('active');
  }
}

function onLoginSuccess(data, email) {
  localStorage.setItem('jwt',      data.token);
  localStorage.setItem('username', email);
  localStorage.setItem('userRole', data.user.role);
  currentUserId = data.user._id;

  document.getElementById('loginSection').style.display = 'none';
  document.getElementById('homeUserDisplayName').textContent = email;
  document.getElementById('homePage').style.display = 'block';

  if (data.user.role === 'admin') {
    document.getElementById('registerNavButton').style.display = 'flex';
  }

  Promise.all([loadRooms(), loadAllUsers()]).then(connectToSocket);
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const apiKey = localStorage.getItem('apiKey');
  if (!apiKey) {
    showToast('Please set your API key first (click the ⚙ button)', 'warning');
    return;
  }

  const body = {
    email:    document.getElementById('username').value,
    password: document.getElementById('password').value,
  };

  try {
    const res = await fetch('https://chatapp-backend-api-production.up.railway.app/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      onLoginSuccess(data, body.email);
    } else {
      showToast('Invalid credentials. Please try again.', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('Connection error. Please check your API key.', 'error');
  }
});

document.getElementById('firstLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const apiKey = localStorage.getItem('apiKey');
  if (!apiKey) {
    showToast('Please set your API key first (click the ⚙ button)', 'warning');
    return;
  }

  const password        = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  if (password !== confirmPassword) {
    showToast('Passwords do not match', 'error');
    return;
  }

  const body = {
    email:        document.getElementById('firstLoginEmail').value,
    oneTimeToken: document.getElementById('oneTimeToken').value,
    password,
  };

  try {
    const res = await fetch('https://chatapp-backend-api-production.up.railway.app/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      onLoginSuccess(data, body.email);
    } else {
      showToast('Setup failed. Please check your token and try again.', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('An error occurred. Please try again.', 'error');
  }
});

// ============================================================
// Logout
// ============================================================
function logout() {
  localStorage.removeItem('jwt');
  localStorage.removeItem('username');
  localStorage.removeItem('userRole');
  currentUserId = null;
  allUsersData  = [];
  unreadCounts  = {};

  document.getElementById('loginSection').style.display    = 'block';
  document.getElementById('homePage').style.display        = 'none';
  document.getElementById('adminSection').style.display    = 'none';
  document.getElementById('registrationSuccess').style.display = 'none';

  document.getElementById('loginForm').reset();
  document.getElementById('adminRegisterForm')?.reset();

  if (socket) { socket.disconnect(); socket = null; }
}

// ============================================================
// Room Creation
// ============================================================
document.getElementById('createRoomForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const apiKey = localStorage.getItem('apiKey');
  const jwt    = localStorage.getItem('jwt');
  if (!apiKey || !jwt) { showToast('Not authenticated', 'error'); return; }

  const body = {
    name: document.getElementById('roomNameInput').value,
    type: document.getElementById('roomType').value,
  };

  try {
    const res = await fetch('https://chatapp-backend-api-production.up.railway.app/api/createRoom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey, Authorization: jwt },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      document.getElementById('createRoomForm').reset();
      showToast(`Room "${body.name}" created!`, 'success');
      await loadRooms();
    } else {
      const err = await res.json();
      showToast(err.message || 'Failed to create room', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('An error occurred while creating the room', 'error');
  }
});

// ============================================================
// Admin — Register User
// ============================================================
function showRegisterForm() {
  document.querySelector('.dashboard-section').style.display = 'none';
  document.getElementById('adminSection').style.display = 'block';
}

function backToHome() {
  document.querySelector('.dashboard-section').style.display = 'grid';
  document.getElementById('adminSection').style.display          = 'none';
  document.getElementById('registrationSuccess').style.display   = 'none';
}

document.getElementById('adminRegisterForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const apiKey = localStorage.getItem('apiKey');
  const jwt    = localStorage.getItem('jwt');
  if (!apiKey || !jwt) { showToast('Missing API key or not logged in', 'error'); return; }

  const body = {
    username: document.getElementById('newUsername').value,
    email:    document.getElementById('newEmail').value,
  };

  try {
    const res = await fetch('https://chatapp-backend-api-production.up.railway.app/api/registerUser', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey, Authorization: jwt },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      document.getElementById('createdUsername').textContent = body.username;
      document.getElementById('createdEmail').textContent    = body.email;
      document.getElementById('setupToken').value            = data.user.oneTimeToken;

      document.getElementById('adminRegisterForm').style.display  = 'none';
      document.getElementById('registrationSuccess').style.display = 'block';
      document.getElementById('adminRegisterForm').reset();

      // Ensure Back to Home button exists
      if (!document.getElementById('registrationSuccess').querySelector('.back-home-btn')) {
        const btn = document.createElement('button');
        btn.textContent = 'Back to Home';
        btn.className   = 'btn-back-text back-home-btn';
        btn.style.marginTop = '16px';
        btn.onclick = backToHome;
        document.getElementById('registrationSuccess').appendChild(btn);
      }
    } else {
      showToast('Registration failed. Please try again.', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('Registration failed', 'error');
  }
});

// Copy token
document.getElementById('copyTokenButton').addEventListener('click', async () => {
  const input = document.getElementById('setupToken');
  try {
    await navigator.clipboard.writeText(input.value);
    const btn = document.getElementById('copyTokenButton');
    btn.textContent = '✓ Copied!';
    btn.style.background = 'linear-gradient(135deg, #48bb78, #38a169)';
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.style.background = '';
    }, 2000);
    showToast('Token copied to clipboard', 'success', 2500);
  } catch {
    // Fallback
    input.select();
    document.execCommand('copy');
    showToast('Token copied', 'success', 2500);
  }
});

function backToRegistration() {
  document.getElementById('registrationSuccess').style.display = 'none';
  document.getElementById('adminRegisterForm').style.display   = 'block';
}

// ============================================================
// Invite Modal
// ============================================================
function showInviteModal() {
  const modal         = document.getElementById('inviteModal');
  const userSelection = modal.querySelector('.user-selection');
  userSelection.innerHTML = '';

  const allUsers = Array.from(document.querySelectorAll('#usersList .user-item')).map(item => ({
    id:       item.getAttribute('data-user-id'),
    username: item.querySelector('.user-name')?.textContent || '',
  }));

  if (allUsers.length === 0) {
    userSelection.innerHTML = '<p style="padding:16px;color:var(--text-3);text-align:center;font-size:13px">No users available</p>';
  } else {
    allUsers.forEach((user) => {
      const item = document.createElement('div');
      item.className = 'user-checkbox-item';
      item.innerHTML = `
        <input type="checkbox" id="inv-${user.id}" value="${user.username}">
        <label for="inv-${user.id}">${user.username}</label>`;
      userSelection.appendChild(item);
    });
  }

  modal.style.display = 'flex';
}

function closeInviteModal() {
  document.getElementById('inviteModal').style.display = 'none';
}

async function sendInvites() {
  const roomName = document.getElementById('currentRoomTitle').textContent;
  const selected = Array.from(
    document.querySelectorAll('.user-checkbox-item input:checked')
  ).map(cb => cb.value);

  if (selected.length === 0) {
    showToast('Please select at least one user to invite', 'warning');
    return;
  }

  try {
    const res = await fetch('https://chatapp-backend-api-production.up.railway.app/api/inviteUser', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': localStorage.getItem('apiKey'),
        Authorization: localStorage.getItem('jwt'),
      },
      body: JSON.stringify({ roomName, invitedusers: selected }),
    });

    if (res.ok) {
      showToast(`Invitation${selected.length > 1 ? 's' : ''} sent successfully!`, 'success');
      closeInviteModal();
    } else {
      const err = await res.json();
      showToast(err.message || 'Failed to send invites', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('Failed to send invites', 'error');
  }
}

// ============================================================
// Message History
// ============================================================
async function loadMessageHistory(params) {
  const apiKey = localStorage.getItem('apiKey');
  const jwt    = localStorage.getItem('jwt');
  if (!apiKey || !jwt) return [];

  try {
    const qs  = new URLSearchParams(params).toString();
    const res = await fetch(
      `https://chatapp-backend-api-production.up.railway.app/api/getMessages?${qs}`,
      { headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey, Authorization: jwt } }
    );
    if (res.ok) return await res.json();
    return [];
  } catch (err) {
    console.error('Error loading messages:', err);
    return [];
  }
}

// ============================================================
// Deprecated but kept for compatibility
// ============================================================
function showError(message, context = 'form') {
  showToast(message, 'error');
}

function showSuccess(message) {
  showToast(message, 'success');
}

// ============================================================
// Utilities
// ============================================================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Cleanup on close
window.addEventListener('beforeunload', () => {
  if (socket) socket.disconnect();
});

// Pre-fill API key indicator on page load
window.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem('apiKey')) {
    // Just a silent indicator — no intrusive panel open
    const toggleBtn = document.getElementById('settingsToggleBtn');
    if (toggleBtn) toggleBtn.title = 'API Key is set — click to change';
  }
});
