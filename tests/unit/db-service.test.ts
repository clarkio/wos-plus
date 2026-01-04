import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { saveBoard, type Slot } from '@scripts/db-service';
import { mockFetchResponse } from '../test-utils';

/**
 * Unit tests for db-service.ts module
 */

describe('db-service module', () => {
  let consoleWarnSpy: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    // Mock console methods to avoid cluttering test output
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('saveBoard', () => {
    const validSlots: Slot[] = [
      {
        letters: ['t', 'e', 's', 't'],
        user: 'testuser',
        hitMax: false,
        word: 'test',
      },
      {
        letters: ['w', 'o', 'r', 'd'],
        user: 'anotheruser',
        hitMax: true,
        word: 'word',
      },
    ];

    describe('boardId validation', () => {
      it('should reject empty boardId string', async () => {
        const result = await saveBoard('', validSlots);
        
        expect(result).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Cannot save board: boardId must be a non-empty string.');
      });

      it('should reject non-string boardId', async () => {
        const result = await saveBoard(null as any, validSlots);
        
        expect(result).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Cannot save board: boardId must be a non-empty string.');
      });

      it('should reject undefined boardId', async () => {
        const result = await saveBoard(undefined as any, validSlots);
        
        expect(result).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Cannot save board: boardId must be a non-empty string.');
      });

      it('should reject boardId longer than 20 characters after cleanup', async () => {
        const longBoardId = 'a'.repeat(21);
        const result = await saveBoard(longBoardId, validSlots);
        
        expect(result).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Cannot save board: boardId exceeds maximum length of 20 characters.');
      });
    });

    describe('boardId cleanup', () => {
      it('should remove spaces from boardId', async () => {
        global.fetch = vi.fn(() => mockFetchResponse({ success: true }));
        
        await saveBoard('W O R D', validSlots);
        
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/boards',
          expect.objectContaining({
            body: expect.stringContaining('"id":"WORD"'),
          })
        );
      });

      it('should convert boardId to uppercase', async () => {
        global.fetch = vi.fn(() => mockFetchResponse({ success: true }));
        
        await saveBoard('test', validSlots);
        
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/boards',
          expect.objectContaining({
            body: expect.stringContaining('"id":"TEST"'),
          })
        );
      });

      it('should remove multiple spaces and convert to uppercase', async () => {
        global.fetch = vi.fn(() => mockFetchResponse({ success: true }));
        
        await saveBoard('t e s t   w o r d', validSlots);
        
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/boards',
          expect.objectContaining({
            body: expect.stringContaining('"id":"TESTWORD"'),
          })
        );
      });
    });

    describe('slots array validation', () => {
      it('should reject empty slots array', async () => {
        const result = await saveBoard('TEST', []);
        
        expect(result).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Cannot save board: slots must be a non-empty array.');
      });

      it('should reject non-array slots', async () => {
        const result = await saveBoard('TEST', null as any);
        
        expect(result).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Cannot save board: slots must be a non-empty array.');
      });

      it('should reject undefined slots', async () => {
        const result = await saveBoard('TEST', undefined as any);
        
        expect(result).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Cannot save board: slots must be a non-empty array.');
      });
    });

    describe('slot structure validation', () => {
      it('should reject slot without letters array', async () => {
        const invalidSlots = [
          {
            user: 'testuser',
            hitMax: false,
            word: 'test',
          } as any,
        ];
        
        const result = await saveBoard('TEST', invalidSlots);
        
        expect(result).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Cannot save board: invalid slot structure detected.');
      });

      it('should reject slot with non-array letters', async () => {
        const invalidSlots = [
          {
            letters: 'test',
            user: 'testuser',
            hitMax: false,
            word: 'test',
          } as any,
        ];
        
        const result = await saveBoard('TEST', invalidSlots);
        
        expect(result).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Cannot save board: invalid slot structure detected.');
      });

      it('should reject slot without hitMax boolean', async () => {
        const invalidSlots = [
          {
            letters: ['t', 'e', 's', 't'],
            user: 'testuser',
            word: 'test',
          } as any,
        ];
        
        const result = await saveBoard('TEST', invalidSlots);
        
        expect(result).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Cannot save board: invalid slot structure detected.');
      });

      it('should reject slot with non-boolean hitMax', async () => {
        const invalidSlots = [
          {
            letters: ['t', 'e', 's', 't'],
            user: 'testuser',
            hitMax: 'false',
            word: 'test',
          } as any,
        ];
        
        const result = await saveBoard('TEST', invalidSlots);
        
        expect(result).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Cannot save board: invalid slot structure detected.');
      });

      it('should reject slot without word string', async () => {
        const invalidSlots = [
          {
            letters: ['t', 'e', 's', 't'],
            user: 'testuser',
            hitMax: false,
          } as any,
        ];
        
        const result = await saveBoard('TEST', invalidSlots);
        
        expect(result).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Cannot save board: invalid slot structure detected.');
      });

      it('should reject slot with non-string word', async () => {
        const invalidSlots = [
          {
            letters: ['t', 'e', 's', 't'],
            user: 'testuser',
            hitMax: false,
            word: 123,
          } as any,
        ];
        
        const result = await saveBoard('TEST', invalidSlots);
        
        expect(result).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Cannot save board: invalid slot structure detected.');
      });

      it('should reject null slot in array', async () => {
        const invalidSlots = [
          null,
          {
            letters: ['t', 'e', 's', 't'],
            user: 'testuser',
            hitMax: false,
            word: 'test',
          },
        ] as any;
        
        const result = await saveBoard('TEST', invalidSlots);
        
        expect(result).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Cannot save board: invalid slot structure detected.');
      });
    });

    describe('incomplete words detection', () => {
      it('should reject slots with dots in letters', async () => {
        const slotsWithDots: Slot[] = [
          {
            letters: ['t', '.', 's', 't'],
            user: 'testuser',
            hitMax: false,
            word: 't.st',
          },
        ];
        
        const result = await saveBoard('TEST', slotsWithDots);
        
        expect(result).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Cannot save board: some words are incomplete.');
      });

      it('should reject slots with question marks in letters', async () => {
        const slotsWithQuestionMarks: Slot[] = [
          {
            letters: ['t', '?', 's', 't'],
            user: 'testuser',
            hitMax: false,
            word: 't?st',
          },
        ];
        
        const result = await saveBoard('TEST', slotsWithQuestionMarks);
        
        expect(result).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Cannot save board: some words are incomplete.');
      });

      it('should reject slots with empty word string', async () => {
        const slotsWithEmptyWord: Slot[] = [
          {
            letters: ['t', 'e', 's', 't'],
            user: 'testuser',
            hitMax: false,
            word: '',
          },
        ];
        
        const result = await saveBoard('TEST', slotsWithEmptyWord);
        
        expect(result).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Cannot save board: some words are incomplete.');
      });

      it('should reject if any slot has incomplete word', async () => {
        const mixedSlots: Slot[] = [
          {
            letters: ['t', 'e', 's', 't'],
            user: 'testuser',
            hitMax: false,
            word: 'test',
          },
          {
            letters: ['w', '?', 'r', 'd'],
            user: 'anotheruser',
            hitMax: false,
            word: 'w?rd',
          },
        ];
        
        const result = await saveBoard('TEST', mixedSlots);
        
        expect(result).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Cannot save board: some words are incomplete.');
      });
    });

    describe('successful save', () => {
      it('should successfully save valid board data', async () => {
        const mockResponse = { success: true, id: 'TEST' };
        global.fetch = vi.fn(() => mockFetchResponse(mockResponse));
        
        const result = await saveBoard('test', validSlots);
        
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/boards',
          expect.objectContaining({
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          })
        );
        expect(result).toEqual(mockResponse);
        expect(consoleLogSpy).toHaveBeenCalledWith(validSlots);
        expect(consoleLogSpy).toHaveBeenCalledWith('Board TEST saved successfully:', mockResponse);
      });

      it('should send correct request body structure', async () => {
        global.fetch = vi.fn(() => mockFetchResponse({ success: true }));
        
        await saveBoard('TEST', validSlots);
        
        const fetchCall = (global.fetch as any).mock.calls[0];
        const requestBody = JSON.parse(fetchCall[1].body);
        
        expect(requestBody).toHaveProperty('id', 'TEST');
        expect(requestBody).toHaveProperty('slots');
        expect(requestBody.slots).toEqual(validSlots);
        expect(requestBody).toHaveProperty('created_at');
        expect(new Date(requestBody.created_at)).toBeInstanceOf(Date);
      });

      it('should accept slots with optional user field', async () => {
        global.fetch = vi.fn(() => mockFetchResponse({ success: true }));
        
        const slotsWithoutUser: Slot[] = [
          {
            letters: ['t', 'e', 's', 't'],
            hitMax: false,
            word: 'test',
          },
        ];
        
        const result = await saveBoard('TEST', slotsWithoutUser);
        
        expect(result).toBeDefined();
        expect(global.fetch).toHaveBeenCalled();
      });

      it('should accept slots with null user field', async () => {
        global.fetch = vi.fn(() => mockFetchResponse({ success: true }));
        
        const slotsWithNullUser: Slot[] = [
          {
            letters: ['t', 'e', 's', 't'],
            user: null,
            hitMax: false,
            word: 'test',
          },
        ];
        
        const result = await saveBoard('TEST', slotsWithNullUser);
        
        expect(result).toBeDefined();
        expect(global.fetch).toHaveBeenCalled();
      });

      it('should accept slots with optional originalIndex field', async () => {
        global.fetch = vi.fn(() => mockFetchResponse({ success: true }));
        
        const slotsWithOriginalIndex: Slot[] = [
          {
            letters: ['t', 'e', 's', 't'],
            user: 'testuser',
            hitMax: false,
            originalIndex: 5,
            word: 'test',
          },
        ];
        
        const result = await saveBoard('TEST', slotsWithOriginalIndex);
        
        expect(result).toBeDefined();
        expect(global.fetch).toHaveBeenCalled();
      });
    });

    describe('error handling', () => {
      it('should handle network errors gracefully', async () => {
        const networkError = new Error('Network failure');
        global.fetch = vi.fn(() => Promise.reject(networkError));
        
        const result = await saveBoard('TEST', validSlots);
        
        expect(result).toBeUndefined();
        expect(consoleErrorSpy).toHaveBeenCalledWith('Error saving board to Cloudflare Worker:', networkError);
      });

      it('should handle non-ok response status', async () => {
        global.fetch = vi.fn(() => 
          Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: () => Promise.resolve({}),
          } as Response)
        );
        
        const result = await saveBoard('TEST', validSlots);
        
        expect(result).toBeUndefined();
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error saving board to Cloudflare Worker:',
          expect.any(Error)
        );
      });

      it('should handle 404 response', async () => {
        global.fetch = vi.fn(() => 
          Promise.resolve({
            ok: false,
            status: 404,
            statusText: 'Not Found',
            json: () => Promise.resolve({}),
          } as Response)
        );
        
        const result = await saveBoard('TEST', validSlots);
        
        expect(result).toBeUndefined();
        expect(consoleErrorSpy).toHaveBeenCalled();
      });

      it('should handle JSON parsing errors', async () => {
        global.fetch = vi.fn(() => 
          Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.reject(new Error('Invalid JSON')),
          } as Response)
        );
        
        const result = await saveBoard('TEST', validSlots);
        
        expect(result).toBeUndefined();
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error saving board to Cloudflare Worker:',
          expect.any(Error)
        );
      });
    });
  });
});
