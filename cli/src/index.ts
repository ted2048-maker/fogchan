#!/usr/bin/env node

/**
 * Fogchan CLI
 * Command-line tool for client-side encrypted ephemeral chat
 */

import { program } from 'commander';
import * as readline from 'readline';
import {
  generateCredentials,
  encryptMessage,
  decryptMessage,
  createSignedPayload,
  verifyPayload,
  getOrCreateIdentityKeyPair,
  getPublicKeyFingerprint,
  type EncryptedPayload,
  type IdentityKeyPair,
} from './crypto';
import { ApiClient } from './api';

const DEFAULT_SERVER = process.env.FOGCHAN_SERVER || 'https://fogchan.aimail.workers.dev';
const DEFAULT_NAME = process.env.FOGCHAN_DEFAULT_NAME || 'CLI User';
const DEFAULT_POLL_INTERVAL = parseInt(process.env.FOGCHAN_POLL_INTERVAL || '5000', 10);

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatSender(sender: string, fingerprint?: string, verified?: boolean): string {
  const verifyIcon = verified ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  if (fingerprint) {
    return `${sender} \x1b[90m[${fingerprint}]\x1b[0m ${verifyIcon}`;
  }
  // No signature - show red ✗
  return `${sender} ${verifyIcon}`;
}

program
  .name('fogchan')
  .description('Fogchan - Client-side encrypted ephemeral chat CLI')
  .version('1.0.16')
  .addHelpText('after', `
Common Options:
  -n, --name <name>     Your nickname (default: ${DEFAULT_NAME})
  -l, --limit <number>  Number of messages to fetch (history command)
  -y, --yes             Skip confirmation prompt (clear command)

Examples:
  $ fogchan create
  $ fogchan join <roomId> <secretKey> --name "Alice"
  $ fogchan send <roomId> <secretKey> "Hello!" --name "Bot"
  $ fogchan listen <roomId> <secretKey>
  $ fogchan history <roomId> <secretKey> --limit 100

Identity:
  Your identity key is stored in ~/.fogchan/identity.json
  Messages are signed with your private key for verification.

Environment Variables:
  FOGCHAN_DEFAULT_NAME   Default nickname
  FOGCHAN_POLL_INTERVAL  Polling interval in ms (default: 5000)
`);

// Create room
program
  .command('create')
  .description('Create a new chat room')
  .option('-s, --server <url>', 'API server URL', DEFAULT_SERVER)
  .action(async (options) => {
    try {
      const { roomId, secretKey } = await generateCredentials();
      const api = new ApiClient(options.server);

      await api.createRoom(roomId);

      console.log('\n\x1b[32m✓ Room created!\x1b[0m\n');
      console.log(`Room ID:    ${roomId}`);
      console.log(`Secret Key: ${secretKey}`);
      if (options.server !== DEFAULT_SERVER) {
        console.log(`Server:     ${options.server}`);
      }
      console.log('\n\x1b[33m⚠️  The secret key is required to decrypt messages.');
      console.log('   Anyone with the room ID and key can read all messages.\x1b[0m\n');
    } catch (error) {
      console.error(`\x1b[31m✗ Error: ${(error as Error).message}\x1b[0m`);
      process.exit(1);
    }
  });

// Join room (interactive mode)
program
  .command('join <roomId> <secretKey>')
  .description('Join a chat room in interactive mode')
  .option('-s, --server <url>', 'API server URL', DEFAULT_SERVER)
  .option('-n, --name <name>', 'Your nickname', DEFAULT_NAME)
  .action(async (roomId, secretKey, options) => {
    const api = new ApiClient(options.server);
    const name = options.name;

    // Get or create identity key pair
    let identity: IdentityKeyPair;
    let myFingerprint: string;
    try {
      identity = await getOrCreateIdentityKeyPair();
      myFingerprint = await getPublicKeyFingerprint(identity.publicKey);
      console.log(`\x1b[90mIdentity: [${myFingerprint}]\x1b[0m`);
    } catch (error) {
      console.error(`\x1b[31m✗ Failed to load identity: ${(error as Error).message}\x1b[0m`);
      process.exit(1);
    }

    try {
      await api.getRoomInfo(roomId);
      console.log(`\x1b[32m✓ Connected as ${name}\x1b[0m`);
      console.log('Type your message and press Enter to send. Ctrl+C to exit.\n');
    } catch (error) {
      console.error(`\x1b[31m✗ Error: ${(error as Error).message}\x1b[0m`);
      process.exit(1);
    }

    let lastTimestamp = 0;
    const seenIds = new Set<string>();
    let rl: readline.Interface | null = null;

    // Print message and handle prompt
    function printMessage(text: string) {
      if (rl) {
        // Clear current line, print message, restore prompt
        process.stdout.write('\r\x1b[K');
        console.log(text);
        rl.prompt(true);
      } else {
        console.log(text);
      }
    }

    // Polling function
    async function poll() {
      try {
        const messages = await api.getMessages(roomId, lastTimestamp);

        for (const msg of messages) {
          if (seenIds.has(msg.id)) continue;

          try {
            const payload = await decryptMessage(msg.ciphertext, msg.iv, secretKey);
            const verified = await verifyPayload(payload, msg.id, msg.timestamp);
            const time = formatTime(msg.timestamp);

            if (payload.type === 'system') {
              printMessage(`\x1b[90m[${time}] ${payload.content}\x1b[0m`);
            } else {
              const senderDisplay = formatSender(payload.sender, verified.fingerprint, verified.verified);
              // Identify by fingerprint (public key hash), not by nickname
              const isOwn = verified.fingerprint === myFingerprint;
              const senderColor = isOwn ? '\x1b[36m' : '\x1b[33m';
              printMessage(`\x1b[90m[${time}]\x1b[0m ${senderColor}${senderDisplay}:\x1b[0m ${payload.content}`);
            }
          } catch {
            printMessage(`\x1b[31m[${formatTime(msg.timestamp)}] Unable to decrypt message\x1b[0m`);
          }

          seenIds.add(msg.id);
          if (msg.timestamp > lastTimestamp) {
            lastTimestamp = msg.timestamp;
          }
        }
      } catch {
        // Silently retry on polling errors
      }
    }

    // Initial poll (before readline is set up)
    await poll();

    // Start polling interval
    const pollInterval = setInterval(poll, DEFAULT_POLL_INTERVAL);

    // Setup readline for input
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.setPrompt('> ');
    rl.prompt();

    rl.on('line', (line) => {
      const content = line.trim();

      // Clear the user input line and stay there (no empty line)
      process.stdout.write('\x1b[1A\x1b[2K\r');

      if (!content) {
        rl!.prompt();
        return;
      }

      // Optimistic UI: show message immediately
      const time = formatTime(Date.now());
      const senderDisplay = formatSender(name, myFingerprint, true);
      printMessage(`\x1b[90m[${time}]\x1b[0m \x1b[36m${senderDisplay}:\x1b[0m ${content}`);

      // Send in background
      (async () => {
        try {
          const payload = await createSignedPayload(
            name,
            content,
            'text',
            identity.privateKey,
            identity.publicKey
          );

          const { ciphertext, iv } = await encryptMessage(payload, secretKey);
          const result = await api.sendMessage(roomId, ciphertext, iv);

          // Mark as seen so polling won't show it again
          seenIds.add(result.id);
          if (result.timestamp > lastTimestamp) {
            lastTimestamp = result.timestamp;
          }
        } catch (error) {
          printMessage(`\x1b[31m✗ Failed to send "${content}": ${(error as Error).message}\x1b[0m`);
        }
      })();
    });

    rl.on('close', () => {
      clearInterval(pollInterval);
      console.log('\n\x1b[90mDisconnected\x1b[0m');
      process.exit(0);
    });
  });

// Send single message
program
  .command('send <roomId> <secretKey> <message>')
  .description('Send a single message (non-interactive)')
  .option('-s, --server <url>', 'API server URL', DEFAULT_SERVER)
  .option('-n, --name <name>', 'Your nickname', DEFAULT_NAME)
  .action(async (roomId, secretKey, message, options) => {
    const api = new ApiClient(options.server);

    try {
      const identity = await getOrCreateIdentityKeyPair();
      const payload = await createSignedPayload(
        options.name,
        message,
        'text',
        identity.privateKey,
        identity.publicKey
      );

      const { ciphertext, iv } = await encryptMessage(payload, secretKey);
      await api.sendMessage(roomId, ciphertext, iv);

      console.log('\x1b[32m✓ Message sent\x1b[0m');
    } catch (error) {
      console.error(`\x1b[31m✗ Error: ${(error as Error).message}\x1b[0m`);
      process.exit(1);
    }
  });

// Listen to messages (read-only mode)
program
  .command('listen <roomId> <secretKey>')
  .description('Listen to messages in read-only mode')
  .option('-s, --server <url>', 'API server URL', DEFAULT_SERVER)
  .action(async (roomId, secretKey, options) => {
    const api = new ApiClient(options.server);

    try {
      await api.getRoomInfo(roomId);
      console.log('\x1b[32m✓ Connected (read-only mode)\x1b[0m');
      console.log('Press Ctrl+C to exit.\n');
    } catch (error) {
      console.error(`\x1b[31m✗ Error: ${(error as Error).message}\x1b[0m`);
      process.exit(1);
    }

    let lastTimestamp = 0;
    const seenIds = new Set<string>();

    async function poll() {
      try {
        const messages = await api.getMessages(roomId, lastTimestamp);

        for (const msg of messages) {
          if (seenIds.has(msg.id)) continue;

          try {
            const payload = await decryptMessage(msg.ciphertext, msg.iv, secretKey);
            const verified = await verifyPayload(payload, msg.id, msg.timestamp);
            const time = formatTime(msg.timestamp);

            if (payload.type === 'system') {
              console.log(`\x1b[90m[${time}] ${payload.content}\x1b[0m`);
            } else {
              const senderDisplay = formatSender(payload.sender, verified.fingerprint, verified.verified);
              console.log(`\x1b[90m[${time}]\x1b[0m \x1b[33m${senderDisplay}:\x1b[0m ${payload.content}`);
            }
          } catch {
            console.log(`\x1b[31m[${formatTime(msg.timestamp)}] Unable to decrypt message\x1b[0m`);
          }

          seenIds.add(msg.id);
          if (msg.timestamp > lastTimestamp) {
            lastTimestamp = msg.timestamp;
          }
        }
      } catch {
        // Silently retry on polling errors
      }
    }

    // Initial poll
    await poll();

    // Start polling interval
    setInterval(poll, DEFAULT_POLL_INTERVAL);

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      console.log('\n\x1b[90mDisconnected\x1b[0m');
      process.exit(0);
    });
  });

// Get history
program
  .command('history <roomId> <secretKey>')
  .description('Get message history')
  .option('-s, --server <url>', 'API server URL', DEFAULT_SERVER)
  .option('-l, --limit <number>', 'Number of messages to fetch', '50')
  .action(async (roomId, secretKey, options) => {
    const api = new ApiClient(options.server);
    const limit = parseInt(options.limit, 10);

    try {
      const messages = await api.getMessages(roomId, 0, limit);

      if (messages.length === 0) {
        console.log('\x1b[90mNo messages in this room\x1b[0m');
        return;
      }

      console.log(`\x1b[90m--- Last ${messages.length} messages ---\x1b[0m\n`);

      for (const msg of messages) {
        try {
          const payload = await decryptMessage(msg.ciphertext, msg.iv, secretKey);
          const verified = await verifyPayload(payload, msg.id, msg.timestamp);
          const time = formatTime(msg.timestamp);

          if (payload.type === 'system') {
            console.log(`\x1b[90m[${time}] ${payload.content}\x1b[0m`);
          } else {
            const senderDisplay = formatSender(payload.sender, verified.fingerprint, verified.verified);
            console.log(`\x1b[90m[${time}]\x1b[0m \x1b[33m${senderDisplay}:\x1b[0m ${payload.content}`);
          }
        } catch {
          console.log(`\x1b[31m[${formatTime(msg.timestamp)}] Unable to decrypt message\x1b[0m`);
        }
      }
    } catch (error) {
      console.error(`\x1b[31m✗ Error: ${(error as Error).message}\x1b[0m`);
      process.exit(1);
    }
  });

// Room info
program
  .command('info <roomId>')
  .description('Get room information')
  .option('-s, --server <url>', 'API server URL', DEFAULT_SERVER)
  .action(async (roomId, options) => {
    const api = new ApiClient(options.server);

    try {
      const info = await api.getRoomInfo(roomId);
      const createdAt = new Date(info.createdAt).toLocaleString();
      const expiresAt = new Date(info.expiresAt).toLocaleString();
      const daysLeft = Math.ceil((info.expiresAt - Date.now()) / (1000 * 60 * 60 * 24));

      console.log('\n\x1b[32m✓ Room found\x1b[0m\n');
      console.log(`Room ID:       ${info.roomId}`);
      console.log(`Created:       ${createdAt}`);
      console.log(`Expires:       ${expiresAt} (${daysLeft} days left)`);
      console.log(`Messages:      ${info.messageCount}`);
      console.log('');
    } catch (error) {
      console.error(`\x1b[31m✗ Error: ${(error as Error).message}\x1b[0m`);
      process.exit(1);
    }
  });

// Clear messages
program
  .command('clear <roomId>')
  .description('Clear all messages in a room')
  .option('-s, --server <url>', 'API server URL', DEFAULT_SERVER)
  .option('-y, --yes', 'Skip confirmation')
  .action(async (roomId, options) => {
    const api = new ApiClient(options.server);

    if (!options.yes) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question('\x1b[33m⚠️  This will delete all messages for everyone. Continue? [y/N] \x1b[0m', resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== 'y') {
        console.log('Cancelled');
        process.exit(0);
      }
    }

    try {
      await api.clearMessages(roomId);
      console.log('\x1b[32m✓ Messages cleared\x1b[0m');
    } catch (error) {
      console.error(`\x1b[31m✗ Error: ${(error as Error).message}\x1b[0m`);
      process.exit(1);
    }
  });

// Show identity
program
  .command('identity')
  .description('Show your identity fingerprint')
  .action(async () => {
    try {
      const identity = await getOrCreateIdentityKeyPair();
      const fingerprint = await getPublicKeyFingerprint(identity.publicKey);
      console.log(`\nYour identity fingerprint: \x1b[36m[${fingerprint}]\x1b[0m`);
      console.log(`\x1b[90mStored in: ~/.fogchan/identity.json\x1b[0m\n`);
    } catch (error) {
      console.error(`\x1b[31m✗ Error: ${(error as Error).message}\x1b[0m`);
      process.exit(1);
    }
  });

program.parse();
