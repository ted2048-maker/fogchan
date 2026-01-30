/**
 * Fogchan API Client for CLI
 */

export interface RoomInfo {
  roomId: string;
  createdAt: number;
  expiresAt: number;
  messageCount: number;
}

export interface EncryptedMessageResponse {
  id: string;
  ciphertext: string;
  iv: string;
  timestamp: number;
}

export interface SendMessageResponse {
  id: string;
  timestamp: number;
}

export class ApiClient {
  private baseUrl: string;
  private timeout: number;

  constructor(baseUrl: string, timeout: number = 10000) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeout = timeout;
  }

  async createRoom(roomId: string): Promise<RoomInfo> {
    const response = await this.fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create room');
    }

    return response.json();
  }

  async getRoomInfo(roomId: string): Promise<RoomInfo> {
    const response = await this.fetch(`/api/rooms/${roomId}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get room info');
    }

    return response.json();
  }

  async sendMessage(
    roomId: string,
    ciphertext: string,
    iv: string
  ): Promise<SendMessageResponse> {
    const response = await this.fetch(`/api/rooms/${roomId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ciphertext, iv }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to send message');
    }

    return response.json();
  }

  async getMessages(
    roomId: string,
    after: number = 0,
    limit: number = 100
  ): Promise<EncryptedMessageResponse[]> {
    const response = await this.fetch(
      `/api/rooms/${roomId}/messages?after=${after}&limit=${limit}`
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get messages');
    }

    const data = await response.json();
    return data.messages;
  }

  async clearMessages(roomId: string): Promise<void> {
    const response = await this.fetch(`/api/rooms/${roomId}/messages`, {
      method: 'DELETE',
    });

    if (!response.ok && response.status !== 204) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to clear messages');
    }
  }

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
