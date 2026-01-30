/**
 * Fogchan Chat Module
 */

import {
  encryptMessage,
  decryptMessage,
  buildUrl,
  createSignedPayload,
  verifyPayload,
  getOrCreateIdentityKeyPair,
  getPublicKeyFingerprint,
  type PlaintextMessage,
  type IdentityKeyPair,
} from './lib/crypto';
import {
  getRoomInfo,
  sendMessage,
  getMessages,
  clearMessages,
  type EncryptedMessageResponse,
} from './lib/api';

// Extended message type with ciphertext
interface DisplayMessage extends PlaintextMessage {
  ciphertext: string;
}

// State
let roomId: string = '';
let secretKey: string = '';
let nickname: string = '';
let identity: IdentityKeyPair | null = null;
let myFingerprint: string = '';
let lastTimestamp: number = 0;
let pollInterval: ReturnType<typeof setInterval> | null = null;
const displayedMessages = new Set<string>();

// DOM Elements
let roomStatus: HTMLSpanElement;
let expiresAt: HTMLSpanElement;
let copyLinkBtn: HTMLButtonElement;
let clearChatBtn: HTMLButtonElement;
let errorBanner: HTMLDivElement;
let errorMessage: HTMLSpanElement;
let closeErrorBtn: HTMLButtonElement;
let messagesContainer: HTMLDivElement;
let messageSection: HTMLDivElement;
let currentNicknameSpan: HTMLSpanElement;
let messageInput: HTMLInputElement;
let sendMessageBtn: HTMLButtonElement;
let clearModal: HTMLDivElement;
let cancelClearBtn: HTMLButtonElement;
let confirmClearBtn: HTMLButtonElement;
let nicknameModal: HTMLDivElement;
let nicknameInput: HTMLInputElement;
let setNicknameBtn: HTMLButtonElement;

let listenersAttached = false;

export async function initChat(newRoomId: string, newSecretKey: string) {
  roomId = newRoomId;
  secretKey = newSecretKey;
  lastTimestamp = 0;
  displayedMessages.clear();
  nickname = '';

  // Get DOM elements
  roomStatus = document.getElementById('roomStatus') as HTMLSpanElement;
  expiresAt = document.getElementById('expiresAt') as HTMLSpanElement;
  copyLinkBtn = document.getElementById('copyLink') as HTMLButtonElement;
  clearChatBtn = document.getElementById('clearChat') as HTMLButtonElement;
  errorBanner = document.getElementById('errorBanner') as HTMLDivElement;
  errorMessage = document.getElementById('errorMessage') as HTMLSpanElement;
  closeErrorBtn = document.getElementById('closeError') as HTMLButtonElement;
  messagesContainer = document.getElementById('messages') as HTMLDivElement;
  messageSection = document.getElementById('messageSection') as HTMLDivElement;
  currentNicknameSpan = document.getElementById('currentNickname') as HTMLSpanElement;
  messageInput = document.getElementById('messageInput') as HTMLInputElement;
  sendMessageBtn = document.getElementById('sendMessage') as HTMLButtonElement;
  clearModal = document.getElementById('clearModal') as HTMLDivElement;
  cancelClearBtn = document.getElementById('cancelClear') as HTMLButtonElement;
  confirmClearBtn = document.getElementById('confirmClear') as HTMLButtonElement;
  nicknameModal = document.getElementById('nicknameModal') as HTMLDivElement;
  nicknameInput = document.getElementById('nickname') as HTMLInputElement;
  setNicknameBtn = document.getElementById('setNickname') as HTMLButtonElement;

  // Reset UI
  messagesContainer.innerHTML = '';
  errorBanner.style.display = 'none';
  roomStatus.textContent = 'Connecting...';
  roomStatus.className = 'room-status';
  currentNicknameSpan.textContent = '';
  messageInput.disabled = true;
  sendMessageBtn.disabled = true;
  nicknameInput.value = '';

  // Initialize identity
  try {
    identity = await getOrCreateIdentityKeyPair();
    myFingerprint = await getPublicKeyFingerprint(identity.publicKey);
  } catch (error) {
    console.error('Failed to initialize identity:', error);
  }

  // Load room info and start polling
  loadRoomInfo();
  startPolling();

  // Show nickname modal
  showNicknameModal();

  // Setup event listeners (only once)
  if (!listenersAttached) {
    setupEventListeners();
    listenersAttached = true;
  }
}

export function destroyChat() {
  stopPolling();
  roomId = '';
  secretKey = '';
  nickname = '';
  lastTimestamp = 0;
  displayedMessages.clear();
  if (nicknameModal) nicknameModal.style.display = 'none';
  if (clearModal) clearModal.style.display = 'none';
}

function showNicknameModal() {
  nicknameModal.style.display = 'flex';
  nicknameInput.value = '';
  setTimeout(() => nicknameInput.focus(), 100);
}

function hideNicknameModal() {
  nicknameModal.style.display = 'none';
}

async function loadRoomInfo() {
  try {
    const info = await getRoomInfo(roomId);
    roomStatus.textContent = 'Connected';
    roomStatus.className = 'room-status connected';

    const daysLeft = Math.ceil((info.expiresAt - Date.now()) / (1000 * 60 * 60 * 24));
    expiresAt.textContent = `Expires in ${daysLeft} days`;
  } catch (error) {
    roomStatus.textContent = 'Connection failed';
    roomStatus.className = 'room-status error';
    showError('Failed to connect: ' + (error as Error).message);
  }
}

function startPolling() {
  poll();
  pollInterval = setInterval(poll, 5000);
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  document.removeEventListener('visibilitychange', handleVisibilityChange);
}

function handleVisibilityChange() {
  if (document.hidden) {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  } else if (roomId) {
    poll();
    pollInterval = setInterval(poll, 5000);
  }
}

async function poll() {
  if (!roomId || !secretKey) return;

  try {
    const { messages, messageCount } = await getMessages(roomId, lastTimestamp);

    // If server has no messages but we have local messages, clear them
    if (messageCount === 0 && displayedMessages.size > 0) {
      messagesContainer.innerHTML = '';
      displayedMessages.clear();
      lastTimestamp = 0;
      return;
    }

    for (const msg of messages) {
      if (displayedMessages.has(msg.id)) continue;

      try {
        const payload = await decryptMessage(msg.ciphertext, msg.iv, secretKey);
        const verified = await verifyPayload(payload, msg.id, msg.timestamp);
        const displayMsg: DisplayMessage = {
          id: msg.id,
          sender: verified.sender,
          content: verified.content,
          timestamp: verified.timestamp,
          type: verified.type,
          ciphertext: msg.ciphertext,
          publicKey: verified.publicKey,
          fingerprint: verified.fingerprint,
          verified: verified.verified,
        };
        renderMessage(displayMsg);
      } catch (e) {
        renderDecryptError(msg);
      }

      displayedMessages.add(msg.id);
      if (msg.timestamp > lastTimestamp) {
        lastTimestamp = msg.timestamp;
      }
    }
  } catch (error) {
    console.error('Polling error:', error);
  }
}

function renderMessage(msg: DisplayMessage, status?: 'sending' | 'sent' | 'failed') {
  const div = document.createElement('div');
  div.dataset.messageId = msg.id;
  // Identify by fingerprint (public key hash), not by nickname
  const isOwn = msg.fingerprint ? msg.fingerprint === myFingerprint : false;

  if (msg.type === 'system') {
    div.className = 'message system';
    div.textContent = msg.content;
  } else {
    div.className = `message ${isOwn ? 'own' : 'other'}`;
    if (status === 'sending') {
      div.classList.add('sending');
    } else if (status === 'failed') {
      div.classList.add('failed');
    }

    const header = document.createElement('div');
    header.className = 'message-header';

    const senderContainer = document.createElement('span');
    senderContainer.className = 'message-sender';

    // Sender name
    const senderName = document.createElement('span');
    senderName.textContent = msg.sender;
    senderContainer.appendChild(senderName);

    // Fingerprint badge
    if (msg.fingerprint) {
      const fingerprint = document.createElement('span');
      fingerprint.className = 'message-fingerprint';
      fingerprint.textContent = `[${msg.fingerprint}]`;
      fingerprint.title = 'Identity fingerprint';
      senderContainer.appendChild(fingerprint);

      // Verification icon
      const verifyIcon = document.createElement('span');
      verifyIcon.className = msg.verified ? 'verify-icon verified' : 'verify-icon unverified';
      verifyIcon.textContent = msg.verified ? '✓' : '✗';
      verifyIcon.title = msg.verified ? 'Signature verified' : 'Signature invalid';
      senderContainer.appendChild(verifyIcon);
    }

    const headerRight = document.createElement('div');
    headerRight.className = 'message-header-right';

    // Status indicator for own messages
    if (isOwn && status) {
      const statusEl = document.createElement('span');
      statusEl.className = 'message-status';
      if (status === 'sending') {
        statusEl.textContent = 'Sending...';
      } else if (status === 'failed') {
        statusEl.textContent = 'Failed';
        statusEl.classList.add('error');
      }
      headerRight.appendChild(statusEl);
    }

    const time = document.createElement('span');
    time.className = 'message-time';
    time.textContent = formatTime(msg.timestamp);

    const lockBtn = document.createElement('button');
    lockBtn.className = 'message-lock';
    lockBtn.textContent = '🔒';
    lockBtn.title = 'Show encrypted data';

    headerRight.appendChild(time);
    headerRight.appendChild(lockBtn);

    header.appendChild(senderContainer);
    header.appendChild(headerRight);

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = msg.content;

    const cipherBox = document.createElement('div');
    cipherBox.className = 'message-cipher';
    cipherBox.style.display = 'none';

    const cipherLabel = document.createElement('div');
    cipherLabel.className = 'cipher-label';
    cipherLabel.textContent = 'Msg Encrypted:';

    const cipherText = document.createElement('div');
    cipherText.className = 'cipher-text';
    cipherText.textContent = msg.ciphertext;

    cipherBox.appendChild(cipherLabel);
    cipherBox.appendChild(cipherText);

    // Toggle cipher visibility
    lockBtn.addEventListener('click', () => {
      const isVisible = cipherBox.style.display !== 'none';
      cipherBox.style.display = isVisible ? 'none' : 'block';
      lockBtn.textContent = isVisible ? '🔒' : '🔓';
      lockBtn.title = isVisible ? 'Show encrypted data' : 'Hide encrypted data';
    });

    div.appendChild(header);
    div.appendChild(content);
    div.appendChild(cipherBox);
  }

  messagesContainer.appendChild(div);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function updateMessageStatus(tempId: string, status: 'sent' | 'failed', newId?: string) {
  const msgEl = document.querySelector(`[data-message-id="${tempId}"]`) as HTMLElement;
  if (!msgEl) return;

  msgEl.classList.remove('sending');

  if (status === 'sent') {
    if (newId) {
      msgEl.dataset.messageId = newId;
    }
    // Remove the status indicator
    const statusEl = msgEl.querySelector('.message-status');
    if (statusEl) {
      statusEl.remove();
    }
  } else if (status === 'failed') {
    msgEl.classList.add('failed');
    const statusEl = msgEl.querySelector('.message-status');
    if (statusEl) {
      statusEl.textContent = 'Failed - tap to retry';
      statusEl.classList.add('error');
    }
  }
}

function updateMessageCipher(tempId: string, ciphertext: string) {
  const msgEl = document.querySelector(`[data-message-id="${tempId}"]`) as HTMLElement;
  if (!msgEl) return;

  const cipherText = msgEl.querySelector('.cipher-text');
  if (cipherText) {
    cipherText.textContent = ciphertext;
  }
}

function renderDecryptError(msg: EncryptedMessageResponse) {
  const div = document.createElement('div');
  div.className = 'message other';

  const header = document.createElement('div');
  header.className = 'message-header';

  const sender = document.createElement('span');
  sender.className = 'message-sender message-error';
  sender.textContent = 'Unknown';

  const headerRight = document.createElement('div');
  headerRight.className = 'message-header-right';

  const time = document.createElement('span');
  time.className = 'message-time';
  time.textContent = formatTime(msg.timestamp);

  const lockBtn = document.createElement('button');
  lockBtn.className = 'message-lock';
  lockBtn.textContent = '🔒';
  lockBtn.title = 'Show encrypted data';

  headerRight.appendChild(time);
  headerRight.appendChild(lockBtn);

  header.appendChild(sender);
  header.appendChild(headerRight);

  const content = document.createElement('div');
  content.className = 'message-content message-error';
  content.textContent = 'Unable to decrypt this message';

  const cipherBox = document.createElement('div');
  cipherBox.className = 'message-cipher';
  cipherBox.style.display = 'none';

  const cipherLabel = document.createElement('div');
  cipherLabel.className = 'cipher-label';
  cipherLabel.textContent = 'Msg Encrypted:';

  const cipherText = document.createElement('div');
  cipherText.className = 'cipher-text';
  cipherText.textContent = msg.ciphertext;

  cipherBox.appendChild(cipherLabel);
  cipherBox.appendChild(cipherText);

  lockBtn.addEventListener('click', () => {
    const isVisible = cipherBox.style.display !== 'none';
    cipherBox.style.display = isVisible ? 'none' : 'block';
    lockBtn.textContent = isVisible ? '🔒' : '🔓';
    lockBtn.title = isVisible ? 'Show encrypted data' : 'Hide encrypted data';
  });

  div.appendChild(header);
  div.appendChild(content);
  div.appendChild(cipherBox);

  messagesContainer.appendChild(div);
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function showError(message: string) {
  errorMessage.textContent = message;
  errorBanner.style.display = 'flex';
}

function hideError() {
  errorBanner.style.display = 'none';
}

function setupEventListeners() {
  closeErrorBtn.addEventListener('click', hideError);

  copyLinkBtn.addEventListener('click', async () => {
    if (!roomId || !secretKey) return;
    try {
      const url = buildUrl(roomId, secretKey);
      await navigator.clipboard.writeText(url);
      copyLinkBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyLinkBtn.textContent = 'Copy URL';
      }, 2000);
    } catch {
      alert('Copy failed. Please copy the URL manually.');
    }
  });

  clearChatBtn.addEventListener('click', () => {
    clearModal.style.display = 'flex';
  });

  cancelClearBtn.addEventListener('click', () => {
    clearModal.style.display = 'none';
  });

  confirmClearBtn.addEventListener('click', async () => {
    if (!roomId) return;
    try {
      await clearMessages(roomId);
      messagesContainer.innerHTML = '';
      displayedMessages.clear();
      lastTimestamp = 0;
      clearModal.style.display = 'none';
    } catch (error) {
      alert('Failed to clear: ' + (error as Error).message);
    }
  });

  setNicknameBtn.addEventListener('click', confirmNickname);

  nicknameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      confirmNickname();
    }
  });

  sendMessageBtn.addEventListener('click', sendChatMessage);
  messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendChatMessage();
    }
  });
}

function confirmNickname() {
  const name = nicknameInput.value.trim();
  if (!name) {
    nicknameInput.focus();
    return;
  }
  nickname = name;
  // Display nickname with fingerprint
  if (myFingerprint) {
    currentNicknameSpan.innerHTML = `${nickname} <span class="my-fingerprint">[${myFingerprint}]</span>`;
  } else {
    currentNicknameSpan.textContent = nickname;
  }
  messageInput.disabled = false;
  sendMessageBtn.disabled = false;
  hideNicknameModal();
  messageInput.focus();
}

let pendingMessageId = 0;

async function sendChatMessage() {
  if (!roomId || !secretKey || !nickname || !identity) return;

  const content = messageInput.value.trim();
  if (!content) return;

  // Clear input immediately (optimistic UI)
  messageInput.value = '';
  messageInput.focus();

  // Generate temporary ID for optimistic rendering
  const tempId = `pending-${++pendingMessageId}`;
  const timestamp = Date.now();

  // Render message immediately with "sending" status
  const tempMsg: DisplayMessage = {
    id: tempId,
    sender: nickname,
    content,
    timestamp,
    type: 'text',
    ciphertext: '(encrypting...)',
    publicKey: identity.publicKey,
    fingerprint: myFingerprint,
    verified: true, // Own message is always verified
  };
  renderMessage(tempMsg, 'sending');

  try {
    // Create signed payload
    const payload = await createSignedPayload(
      nickname,
      content,
      'text',
      identity.privateKey,
      identity.publicKey
    );

    const { ciphertext, iv } = await encryptMessage(payload, secretKey);

    // Update ciphertext display
    updateMessageCipher(tempId, ciphertext);

    const result = await sendMessage(roomId, ciphertext, iv);

    // Mark as sent successfully
    displayedMessages.add(result.id);
    if (result.timestamp > lastTimestamp) {
      lastTimestamp = result.timestamp;
    }
    updateMessageStatus(tempId, 'sent', result.id);
  } catch (error) {
    // Mark as failed
    updateMessageStatus(tempId, 'failed');
    console.error('Failed to send:', error);
  }
}
