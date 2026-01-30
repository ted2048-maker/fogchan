-- Fogchan Database Schema

-- Rooms table
CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

-- Index for querying messages by room and timestamp
CREATE INDEX IF NOT EXISTS idx_messages_room_timestamp ON messages(room_id, timestamp);

-- Index for cleaning up expired rooms
CREATE INDEX IF NOT EXISTS idx_rooms_expires ON rooms(expires_at);

-- Index for cleaning up idle rooms
CREATE INDEX IF NOT EXISTS idx_rooms_activity ON rooms(last_activity_at);
