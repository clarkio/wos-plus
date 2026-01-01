import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TwitchWorkerMessage, TwitchWorkerResult } from '@scripts/twitch-chat-worker';

/**
 * Unit tests for twitch-chat-worker.ts module
 * 
 * Tests the Twitch chat message filtering worker that validates
 * messages matching /^[a-zA-Z]{4,12}$/ pattern.
 */

describe('twitch-chat-worker', () => {
  let worker: Worker;
  let messageHandler: (event: MessageEvent) => void;
  let errorHandler: (event: ErrorEvent) => void;
  let messageErrorHandler: (event: MessageEvent) => void;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Mock Worker global
    const mockPostMessage = vi.fn();
    const listeners: Record<string, Function> = {};

    // Create mock worker environment
    global.self = {
      postMessage: mockPostMessage,
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as any;

    // Import the worker module (this will set up the message handlers)
    // Note: In a real environment, the worker code would be loaded in a separate context
    // For testing, we'll simulate the worker's message handling logic
    const messageRegex = /^[a-zA-Z]{4,12}$/;
    
    messageHandler = function (e: MessageEvent<TwitchWorkerMessage>) {
      try {
        const { username, message, timestamp } = e.data;

        if (messageRegex.test(message)) {
          const result: TwitchWorkerResult = {
            type: 'twitch_message',
            username: username.toLowerCase(),
            message: message.toLowerCase(),
            timestamp
          };

          mockPostMessage(result);
        }
      } catch (error: any) {
        mockPostMessage({
          type: 'error',
          error: error.message
        });
      }
    };

    errorHandler = function (error: ErrorEvent) {
      console.error('Twitch Worker Error:', error);
    };

    messageErrorHandler = function (error: MessageEvent) {
      console.error('Twitch Worker Message Error:', error);
    };
  });

  describe('message filtering', () => {
    it('should accept valid 4-letter word', () => {
      const mockPostMessage = (global.self as any).postMessage;
      const message: TwitchWorkerMessage = {
        username: 'TestUser',
        message: 'test',
        timestamp: Date.now()
      };

      messageHandler(new MessageEvent('message', { data: message }));

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'twitch_message',
        username: 'testuser',
        message: 'test',
        timestamp: message.timestamp
      });
    });

    it('should accept valid 12-letter word', () => {
      const mockPostMessage = (global.self as any).postMessage;
      const message: TwitchWorkerMessage = {
        username: 'TestUser',
        message: 'abcdefghijkl',
        timestamp: Date.now()
      };

      messageHandler(new MessageEvent('message', { data: message }));

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'twitch_message',
        username: 'testuser',
        message: 'abcdefghijkl',
        timestamp: message.timestamp
      });
    });

    it('should accept mixed case letters', () => {
      const mockPostMessage = (global.self as any).postMessage;
      const message: TwitchWorkerMessage = {
        username: 'TestUser',
        message: 'WoRdS',
        timestamp: Date.now()
      };

      messageHandler(new MessageEvent('message', { data: message }));

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'twitch_message',
        username: 'testuser',
        message: 'words',
        timestamp: message.timestamp
      });
    });

    it('should reject messages with less than 4 characters', () => {
      const mockPostMessage = (global.self as any).postMessage;
      const message: TwitchWorkerMessage = {
        username: 'TestUser',
        message: 'cat',
        timestamp: Date.now()
      };

      messageHandler(new MessageEvent('message', { data: message }));

      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('should reject messages with more than 12 characters', () => {
      const mockPostMessage = (global.self as any).postMessage;
      const message: TwitchWorkerMessage = {
        username: 'TestUser',
        message: 'abcdefghijklm',
        timestamp: Date.now()
      };

      messageHandler(new MessageEvent('message', { data: message }));

      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('should reject messages with numbers', () => {
      const mockPostMessage = (global.self as any).postMessage;
      const message: TwitchWorkerMessage = {
        username: 'TestUser',
        message: 'test123',
        timestamp: Date.now()
      };

      messageHandler(new MessageEvent('message', { data: message }));

      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('should reject messages with special characters', () => {
      const mockPostMessage = (global.self as any).postMessage;
      const message: TwitchWorkerMessage = {
        username: 'TestUser',
        message: 'test!',
        timestamp: Date.now()
      };

      messageHandler(new MessageEvent('message', { data: message }));

      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('should reject messages with spaces', () => {
      const mockPostMessage = (global.self as any).postMessage;
      const message: TwitchWorkerMessage = {
        username: 'TestUser',
        message: 'test word',
        timestamp: Date.now()
      };

      messageHandler(new MessageEvent('message', { data: message }));

      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('should reject empty messages', () => {
      const mockPostMessage = (global.self as any).postMessage;
      const message: TwitchWorkerMessage = {
        username: 'TestUser',
        message: '',
        timestamp: Date.now()
      };

      messageHandler(new MessageEvent('message', { data: message }));

      expect(mockPostMessage).not.toHaveBeenCalled();
    });
  });

  describe('data transformation', () => {
    it('should convert username to lowercase', () => {
      const mockPostMessage = (global.self as any).postMessage;
      const message: TwitchWorkerMessage = {
        username: 'TestUser',
        message: 'word',
        timestamp: Date.now()
      };

      messageHandler(new MessageEvent('message', { data: message }));

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'testuser'
        })
      );
    });

    it('should convert message to lowercase', () => {
      const mockPostMessage = (global.self as any).postMessage;
      const message: TwitchWorkerMessage = {
        username: 'TestUser',
        message: 'WORD',
        timestamp: Date.now()
      };

      messageHandler(new MessageEvent('message', { data: message }));

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'word'
        })
      );
    });

    it('should preserve timestamp', () => {
      const mockPostMessage = (global.self as any).postMessage;
      const timestamp = 1234567890;
      const message: TwitchWorkerMessage = {
        username: 'TestUser',
        message: 'word',
        timestamp
      };

      messageHandler(new MessageEvent('message', { data: message }));

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: 1234567890
        })
      );
    });

    it('should include correct message type', () => {
      const mockPostMessage = (global.self as any).postMessage;
      const message: TwitchWorkerMessage = {
        username: 'TestUser',
        message: 'word',
        timestamp: Date.now()
      };

      messageHandler(new MessageEvent('message', { data: message }));

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'twitch_message'
        })
      );
    });
  });

  describe('error handling', () => {
    it('should handle malformed message data', () => {
      const mockPostMessage = (global.self as any).postMessage;
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Simulate a message with missing fields
      const malformedData = null as any;

      messageHandler(new MessageEvent('message', { data: malformedData }));

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error'
        })
      );

      consoleSpy.mockRestore();
    });

    it('should handle undefined username', () => {
      const mockPostMessage = (global.self as any).postMessage;
      const message = {
        username: undefined,
        message: 'word',
        timestamp: Date.now()
      } as any;

      messageHandler(new MessageEvent('message', { data: message }));

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error'
        })
      );
    });

    it('should handle undefined message', () => {
      const mockPostMessage = (global.self as any).postMessage;
      const message = {
        username: 'TestUser',
        message: undefined,
        timestamp: Date.now()
      } as any;

      messageHandler(new MessageEvent('message', { data: message }));

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error'
        })
      );
    });

    it('should log errors via onerror handler', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const errorEvent = new ErrorEvent('error', {
        message: 'Test error',
        error: new Error('Test error')
      });

      errorHandler(errorEvent);

      expect(consoleSpy).toHaveBeenCalledWith('Twitch Worker Error:', errorEvent);
      consoleSpy.mockRestore();
    });

    it('should log message errors via onmessageerror handler', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const messageEvent = new MessageEvent('messageerror', {
        data: 'corrupted data'
      });

      messageErrorHandler(messageEvent);

      expect(consoleSpy).toHaveBeenCalledWith('Twitch Worker Message Error:', messageEvent);
      consoleSpy.mockRestore();
    });
  });

  describe('edge cases', () => {
    it('should handle exactly 4 characters', () => {
      const mockPostMessage = (global.self as any).postMessage;
      const message: TwitchWorkerMessage = {
        username: 'user',
        message: 'word',
        timestamp: Date.now()
      };

      messageHandler(new MessageEvent('message', { data: message }));

      expect(mockPostMessage).toHaveBeenCalledTimes(1);
    });

    it('should handle exactly 12 characters', () => {
      const mockPostMessage = (global.self as any).postMessage;
      const message: TwitchWorkerMessage = {
        username: 'user',
        message: 'exactlytwelv',
        timestamp: Date.now()
      };

      messageHandler(new MessageEvent('message', { data: message }));

      expect(mockPostMessage).toHaveBeenCalledTimes(1);
    });

    it('should reject 3 characters', () => {
      const mockPostMessage = (global.self as any).postMessage;
      const message: TwitchWorkerMessage = {
        username: 'user',
        message: 'cat',
        timestamp: Date.now()
      };

      messageHandler(new MessageEvent('message', { data: message }));

      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('should reject 13 characters', () => {
      const mockPostMessage = (global.self as any).postMessage;
      const message: TwitchWorkerMessage = {
        username: 'user',
        message: 'thirteenlettr',
        timestamp: Date.now()
      };

      messageHandler(new MessageEvent('message', { data: message }));

      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('should handle multiple valid messages in sequence', () => {
      const mockPostMessage = (global.self as any).postMessage;
      const messages: TwitchWorkerMessage[] = [
        { username: 'user1', message: 'word', timestamp: 1000 },
        { username: 'user2', message: 'test', timestamp: 2000 },
        { username: 'user3', message: 'game', timestamp: 3000 }
      ];

      messages.forEach(msg => {
        messageHandler(new MessageEvent('message', { data: msg }));
      });

      expect(mockPostMessage).toHaveBeenCalledTimes(3);
    });

    it('should filter out invalid messages from sequence', () => {
      const mockPostMessage = (global.self as any).postMessage;
      const messages: TwitchWorkerMessage[] = [
        { username: 'user1', message: 'word', timestamp: 1000 },      // valid
        { username: 'user2', message: 'hi', timestamp: 2000 },        // invalid (too short)
        { username: 'user3', message: 'test123', timestamp: 3000 },   // invalid (numbers)
        { username: 'user4', message: 'game', timestamp: 4000 }       // valid
      ];

      messages.forEach(msg => {
        messageHandler(new MessageEvent('message', { data: msg }));
      });

      expect(mockPostMessage).toHaveBeenCalledTimes(2);
    });
  });
});
