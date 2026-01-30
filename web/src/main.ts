/**
 * Fogchan Main Entry - Hash Router
 */

import { parseHashRoute, parseUrl, generateCredentials, navigateToChat } from './lib/crypto';
import { createRoom } from './lib/api';
import { initChat, destroyChat } from './chat';

// Views
const homeView = document.getElementById('home-view') as HTMLDivElement;
const chatView = document.getElementById('chat-view') as HTMLDivElement;

// Home elements
const createRoomBtn = document.getElementById('createRoom') as HTMLButtonElement;
const joinUrlInput = document.getElementById('joinUrl') as HTMLInputElement;
const joinRoomBtn = document.getElementById('joinRoom') as HTMLButtonElement;

function showHome() {
  destroyChat();
  homeView.style.display = 'flex';
  chatView.style.display = 'none';
  document.title = 'Fogchan - Private Ephemeral Chat';
}

async function showChat(roomId: string, secretKey: string) {
  homeView.style.display = 'none';
  chatView.style.display = 'flex';
  document.title = 'Fogchan - Chat Room';
  await initChat(roomId, secretKey);
}

function handleRoute() {
  const parsed = parseHashRoute();
  if (parsed) {
    showChat(parsed.roomId, parsed.secretKey);
  } else {
    showHome();
  }
}

// Home event listeners
createRoomBtn.addEventListener('click', async () => {
  createRoomBtn.disabled = true;
  createRoomBtn.textContent = 'Creating...';

  try {
    const { roomId, secretKey } = await generateCredentials();
    await createRoom(roomId);
    navigateToChat(roomId, secretKey);
  } catch (error) {
    alert('Failed to create room: ' + (error as Error).message);
    createRoomBtn.disabled = false;
    createRoomBtn.textContent = 'Create Room';
  }
});

joinRoomBtn.addEventListener('click', () => {
  const url = joinUrlInput.value.trim();
  if (!url) {
    alert('Please enter a room link');
    return;
  }

  const parsed = parseUrl(url);
  if (!parsed) {
    alert('Invalid link format');
    return;
  }

  navigateToChat(parsed.roomId, parsed.secretKey);
});

joinUrlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    joinRoomBtn.click();
  }
});

// Listen for hash changes
window.addEventListener('hashchange', handleRoute);

// Initial route
handleRoute();
