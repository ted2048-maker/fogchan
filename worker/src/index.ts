import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, CreateRoomRequest, SendMessageRequest, Room } from './types';

const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}));

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() });
});

// Create room
app.post('/api/rooms', async (c) => {
  try {
    const body = await c.req.json<CreateRoomRequest>();
    const { roomId } = body;

    // Validate roomId format (32 character hex string)
    if (!roomId || !/^[a-f0-9]{32}$/.test(roomId)) {
      return c.json({ error: 'Invalid room ID format' }, 400);
    }

    const now = Date.now();
    const expiresAt = now + 30 * 24 * 60 * 60 * 1000; // 30 days

    try {
      await c.env.DB.prepare(
        'INSERT INTO rooms (id, created_at, expires_at, last_activity_at) VALUES (?, ?, ?, ?)'
      ).bind(roomId, now, expiresAt, now).run();

      return c.json({ roomId, createdAt: now, expiresAt }, 201);
    } catch (e) {
      // Unique constraint violation - room already exists
      return c.json({ error: 'Room already exists' }, 409);
    }
  } catch (e) {
    return c.json({ error: 'Invalid request body' }, 400);
  }
});

// Get room info
app.get('/api/rooms/:roomId', async (c) => {
  const roomId = c.req.param('roomId');

  // Validate roomId format
  if (!/^[a-f0-9]{32}$/.test(roomId)) {
    return c.json({ error: 'Invalid room ID format' }, 400);
  }

  const room = await c.env.DB.prepare(
    'SELECT * FROM rooms WHERE id = ?'
  ).bind(roomId).first<Room>();

  if (!room) {
    return c.json({ error: 'Room not found' }, 404);
  }

  const countResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM messages WHERE room_id = ?'
  ).bind(roomId).first<{ count: number }>();

  return c.json({
    roomId: room.id,
    createdAt: room.created_at,
    expiresAt: room.expires_at,
    messageCount: countResult?.count || 0,
  });
});

// Send message
app.post('/api/rooms/:roomId/messages', async (c) => {
  const roomId = c.req.param('roomId');

  // Validate roomId format
  if (!/^[a-f0-9]{32}$/.test(roomId)) {
    return c.json({ error: 'Invalid room ID format' }, 400);
  }

  try {
    const body = await c.req.json<SendMessageRequest>();
    const { ciphertext, iv } = body;

    if (!ciphertext || !iv) {
      return c.json({ error: 'Missing ciphertext or iv' }, 400);
    }

    // Check if room exists
    const room = await c.env.DB.prepare(
      'SELECT id FROM rooms WHERE id = ?'
    ).bind(roomId).first();

    if (!room) {
      return c.json({ error: 'Room not found' }, 404);
    }

    const id = crypto.randomUUID();
    const timestamp = Date.now();

    // Insert message and update room activity time
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO messages (id, room_id, ciphertext, iv, timestamp) VALUES (?, ?, ?, ?, ?)'
      ).bind(id, roomId, ciphertext, iv, timestamp),
      c.env.DB.prepare(
        'UPDATE rooms SET last_activity_at = ? WHERE id = ?'
      ).bind(timestamp, roomId),
    ]);

    return c.json({ id, timestamp }, 201);
  } catch (e) {
    return c.json({ error: 'Invalid request body' }, 400);
  }
});

// Get messages (polling endpoint)
app.get('/api/rooms/:roomId/messages', async (c) => {
  const roomId = c.req.param('roomId');

  // Validate roomId format
  if (!/^[a-f0-9]{32}$/.test(roomId)) {
    return c.json({ error: 'Invalid room ID format' }, 400);
  }

  const after = Number(c.req.query('after') || 0);
  const limit = Math.min(Number(c.req.query('limit') || 100), 100);

  // Check if room exists
  const room = await c.env.DB.prepare(
    'SELECT id FROM rooms WHERE id = ?'
  ).bind(roomId).first();

  if (!room) {
    return c.json({ error: 'Room not found' }, 404);
  }

  // Get messages and total count in parallel
  const [messages, countResult] = await Promise.all([
    c.env.DB.prepare(
      'SELECT id, ciphertext, iv, timestamp FROM messages WHERE room_id = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT ?'
    ).bind(roomId, after, limit).all(),
    c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM messages WHERE room_id = ?'
    ).bind(roomId).first<{ count: number }>(),
  ]);

  return c.json({
    messages: messages.results || [],
    messageCount: countResult?.count || 0,
  });
});

// Clear room messages
app.delete('/api/rooms/:roomId/messages', async (c) => {
  const roomId = c.req.param('roomId');

  // Validate roomId format
  if (!/^[a-f0-9]{32}$/.test(roomId)) {
    return c.json({ error: 'Invalid room ID format' }, 400);
  }

  await c.env.DB.prepare(
    'DELETE FROM messages WHERE room_id = ?'
  ).bind(roomId).run();

  return c.body(null, 204);
});

// Delete room
app.delete('/api/rooms/:roomId', async (c) => {
  const roomId = c.req.param('roomId');

  // Validate roomId format
  if (!/^[a-f0-9]{32}$/.test(roomId)) {
    return c.json({ error: 'Invalid room ID format' }, 400);
  }

  // Delete room (messages will be cascade deleted)
  await c.env.DB.prepare(
    'DELETE FROM rooms WHERE id = ?'
  ).bind(roomId).run();

  return c.body(null, 204);
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default {
  fetch: app.fetch,

  // Scheduled cleanup task (runs hourly)
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const now = Date.now();
    const idleThreshold = now - 60 * 60 * 1000; // 1 hour ago

    // Delete expired rooms (cascade deletes messages)
    await env.DB.prepare(
      'DELETE FROM rooms WHERE expires_at < ?'
    ).bind(now).run();

    // Delete messages from idle rooms (keep the room)
    await env.DB.prepare(
      'DELETE FROM messages WHERE room_id IN (SELECT id FROM rooms WHERE last_activity_at < ?)'
    ).bind(idleThreshold).run();

    console.log(`Cleanup completed at ${new Date(now).toISOString()}`);
  },
};
