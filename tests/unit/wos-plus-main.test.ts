import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GameSpectator } from '@scripts/wos-plus-main';
import * as wosWords from '@scripts/wos-words';
import { createMockLocalStorage } from '../test-utils';

// Mock the worker modules
vi.mock('@scripts/wos-worker', () => ({
  default: {}
}));

vi.mock('@scripts/twitch-chat-worker', () => ({
  default: {}
}));

// Mock the wos-words module
vi.mock('@scripts/wos-words', () => ({
  findAllMissingWords: vi.fn(() => []),
  findMissingWordsFromBoard: vi.fn(() => []),
  loadWordsFromDb: vi.fn(),
}));

// Mock the db-service module
vi.mock('@scripts/db-service', () => ({
  saveBoard: vi.fn(),
  fetchBoard: vi.fn(),
}));

// Mock socket.io-client
vi.mock('socket.io-client', () => ({
  default: vi.fn(() => ({
    on: vi.fn(),
    disconnect: vi.fn(),
    io: { opts: { query: {} } }
  }))
}));

// Mock tmi.js
vi.mock('@tmi.js/chat', () => ({
  default: {
    Client: vi.fn(function (this: any) {
      this.on = vi.fn();
      this.connect = vi.fn();
      this.close = vi.fn();
      return this;
    })
  }
}));

describe('GameSpectator class', () => {
  let spectator: GameSpectator;
  let mockLocalStorage: ReturnType<typeof createMockLocalStorage>;

  const getMockWorkers = (): any[] => ((global as any).MockWorker?.instances ?? []);
  const findWorkerByUrlSubstring = (substr: string) =>
    getMockWorkers().find((w) => typeof w.url === 'string' && w.url.includes(substr));

  beforeEach(() => {
    // Setup DOM
    document.body.innerHTML = `
      <div id="pb-value"></div>
      <div id="daily-pb-value"></div>
      <div id="daily-clear-value"></div>
      <div id="level-title"></div>
      <div id="level-value"></div>
      <div id="letters"></div>
      <div id="letters-label"></div>
      <div id="hidden-letter"></div>
      <div id="fake-letter"></div>
      <div id="correct-words-log"></div>
      <div id="wos-game-log"></div>
      <div id="twitch-chat-log"></div>
    `;

    // Mock localStorage
    mockLocalStorage = createMockLocalStorage();
    global.localStorage = mockLocalStorage as any;

    // Mock Audio
    (global as any).Audio = vi.fn(() => ({
      play: vi.fn().mockResolvedValue(undefined)
    }));

    vi.clearAllMocks();
  });

  afterEach(() => {
    if (spectator) {
      spectator.disconnect();
      spectator.disconnectTwitch();
    }
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      spectator = new GameSpectator();

      expect(spectator.currentLevel).toBe(0);
      expect(spectator.personalBest).toBe(0);
      expect(spectator.dailyBest).toBe(0);
      expect(spectator.dailyClears).toBe(0);
      expect(spectator.currentLevelBigWord).toBe('');
      expect(spectator.currentLevelCorrectWords).toEqual([]);
      expect(spectator.currentLevelLetters).toEqual([]);
      expect(spectator.currentLevelSlots).toEqual([]);
      expect(spectator.clearSoundEnabled).toBe(true);
    });

    it('should initialize twitchChatLog as Map', () => {
      spectator = new GameSpectator();

      expect(spectator.twitchChatLog).toBeInstanceOf(Map);
      expect(spectator.twitchChatLog.size).toBe(0);
    });

    it('should initialize wosSocket as null', () => {
      spectator = new GameSpectator();

      expect(spectator.wosSocket).toBeNull();
    });

    it('should register worker message handlers (wos + twitch)', () => {
      spectator = new GameSpectator();

      const wosWorker = findWorkerByUrlSubstring('wos-worker');
      const twitchWorker = findWorkerByUrlSubstring('twitch-chat-worker');

      expect(wosWorker).toBeTruthy();
      expect(twitchWorker).toBeTruthy();

      expect(typeof wosWorker.onmessage).toBe('function');
      expect(typeof twitchWorker.onmessage).toBe('function');
    });
  });

  describe('getTodayKey', () => {
    it('should return today\'s date in ISO format (YYYY-MM-DD)', () => {
      spectator = new GameSpectator();
      const today = new Date().toISOString().slice(0, 10);

      // Access private method through any cast for testing
      const todayKey = (spectator as any).getTodayKey();

      expect(todayKey).toBe(today);
      expect(todayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('getMirrorCode', () => {
    it('should extract game code from valid mirror URL', () => {
      spectator = new GameSpectator();

      const mirrorUrl = 'https://wos2.gartic.es/r/ABC123';
      const code = spectator.getMirrorCode(mirrorUrl);

      expect(code).toBe('ABC123');
    });

    it('should return null for invalid URL format', () => {
      spectator = new GameSpectator();

      const mirrorUrl = 'https://wos2.gartic.es/invalid';
      const code = spectator.getMirrorCode(mirrorUrl);

      expect(code).toBeNull();
    });

    it('should return null for malformed URL', () => {
      spectator = new GameSpectator();

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

      const mirrorUrl = 'not-a-valid-url';
      const code = spectator.getMirrorCode(mirrorUrl);

      expect(code).toBeNull();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('loadChannelRecords', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
    });

    it('should load personal best from localStorage', () => {
      mockLocalStorage.setItem('pb_testchannel', '15');

      (spectator as any).loadChannelRecords('testchannel');

      expect(spectator.personalBest).toBe(15);
      expect(spectator.pbStorageKey).toBe('pb_testchannel');
    });

    it('should default to 0 if no personal best exists', () => {
      (spectator as any).loadChannelRecords('newchannel');

      expect(spectator.personalBest).toBe(0);
    });

    it('should load daily best from localStorage', () => {
      const today = new Date().toISOString().slice(0, 10);
      mockLocalStorage.setItem(`pb_testchannel_${today}`, '10');

      (spectator as any).loadChannelRecords('testchannel');

      expect(spectator.dailyBest).toBe(10);
    });

    it('should load daily clears from localStorage', () => {
      const today = new Date().toISOString().slice(0, 10);
      mockLocalStorage.setItem(`clears_testchannel_${today}`, '3');

      (spectator as any).loadChannelRecords('testchannel');

      expect(spectator.dailyClears).toBe(3);
    });

    it('should update UI with loaded values', () => {
      mockLocalStorage.setItem('pb_testchannel', '20');
      const today = new Date().toISOString().slice(0, 10);
      mockLocalStorage.setItem(`pb_testchannel_${today}`, '15');
      mockLocalStorage.setItem(`clears_testchannel_${today}`, '5');

      (spectator as any).loadChannelRecords('testchannel');

      expect(document.getElementById('pb-value')!.innerText).toBe('20');
      expect(document.getElementById('daily-pb-value')!.innerText).toBe('15');
      expect(document.getElementById('daily-clear-value')!.innerText).toBe('5');
    });
  });

  describe('updateChannelDailyRecord', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
      (spectator as any).loadChannelRecords('testchannel');
    });

    it('should update daily best if level exceeds current', () => {
      spectator.dailyBest = 10;

      (spectator as any).updateChannelDailyRecord(15);

      expect(spectator.dailyBest).toBe(15);
    });

    it('should not update daily best if level does not exceed current', () => {
      spectator.dailyBest = 15;

      (spectator as any).updateChannelDailyRecord(10);

      expect(spectator.dailyBest).toBe(15);
    });

    it('should save updated daily best to localStorage', () => {
      spectator.dailyBest = 10;

      (spectator as any).updateChannelDailyRecord(15);

      const today = new Date().toISOString().slice(0, 10);
      const stored = mockLocalStorage.getItem(`pb_testchannel_${today}`);
      expect(stored).toBe('15');
    });

    it('should update UI element with new daily best', () => {
      spectator.dailyBest = 10;

      (spectator as any).updateChannelDailyRecord(15);

      expect(document.getElementById('daily-pb-value')!.innerText).toBe('15');
    });
  });

  describe('updateChannelAllTimeRecord', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
      (spectator as any).loadChannelRecords('testchannel');
    });

    it('should update personal best if record exceeds current', () => {
      spectator.personalBest = 20;

      (spectator as any).updateChannelAllTimeRecord(25);

      expect(spectator.personalBest).toBe(25);
    });

    it('should not update personal best if record does not exceed current', () => {
      spectator.personalBest = 25;

      (spectator as any).updateChannelAllTimeRecord(20);

      expect(spectator.personalBest).toBe(25);
    });

    it('should save updated personal best to localStorage', () => {
      spectator.personalBest = 20;

      (spectator as any).updateChannelAllTimeRecord(25);

      const stored = mockLocalStorage.getItem('pb_testchannel');
      expect(stored).toBe('25');
    });

    it('should update UI element with new personal best', () => {
      spectator.personalBest = 20;

      (spectator as any).updateChannelAllTimeRecord(25);

      expect(document.getElementById('pb-value')!.innerText).toBe('25');
    });
  });

  describe('recordBoardClear', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
      (spectator as any).loadChannelRecords('testchannel');
    });

    it('should increment daily clears count', () => {
      spectator.dailyClears = 5;

      (spectator as any).recordBoardClear();

      expect(spectator.dailyClears).toBe(6);
    });

    it('should save updated clears count to localStorage', () => {
      spectator.dailyClears = 5;

      (spectator as any).recordBoardClear();

      const today = new Date().toISOString().slice(0, 10);
      const stored = mockLocalStorage.getItem(`clears_testchannel_${today}`);
      expect(stored).toBe('6');
    });

    it('should update UI element with new clears count', () => {
      spectator.dailyClears = 5;

      (spectator as any).recordBoardClear();

      expect(document.getElementById('daily-clear-value')!.innerText).toBe('6');
    });
  });

  describe('clearBoard', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
    });

    it('should reset all game state arrays', () => {
      spectator.currentLevelCorrectWords = ['word1', 'word2'];
      spectator.currentLevelSlots = [{ letters: ['w', 'o', 'r', 'd'], word: 'word', hitMax: false, index: 0, length: 4 }];
      spectator.currentLevelLetters = ['a', 'b', 'c'];

      (spectator as any).clearBoard();

      expect(spectator.currentLevelCorrectWords).toEqual([]);
      expect(spectator.currentLevelSlots).toEqual([]);
      expect(spectator.currentLevelLetters).toEqual([]);
      expect(spectator.currentLevelHiddenLetters).toEqual([]);
      expect(spectator.currentLevelFakeLetters).toEqual([]);
    });

    it('should reset big word', () => {
      spectator.currentLevelBigWord = 'TESTING';

      (spectator as any).clearBoard();

      expect(spectator.currentLevelBigWord).toBe('');
    });

    it('should clear twitch chat log', () => {
      spectator.twitchChatLog.set('user1', { message: 'test', timestamp: Date.now() });

      (spectator as any).clearBoard();

      expect(spectator.twitchChatLog.size).toBe(0);
    });

    it('should clear UI elements', () => {
      document.getElementById('correct-words-log')!.innerText = 'words';
      document.getElementById('letters')!.innerText = 'A B C';

      (spectator as any).clearBoard();

      expect(document.getElementById('correct-words-log')!.innerText).toBe('');
      expect(document.getElementById('letters')!.innerText).toBe('');
      expect(document.getElementById('hidden-letter')!.innerText).toBe('');
      expect(document.getElementById('fake-letter')!.innerText).toBe('');
    });
  });

  describe('updateCurrentLevelSlots', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
      spectator.currentLevelSlots = [
        { letters: [], word: '', hitMax: false, index: 0, length: 4 },
        { letters: [], word: '', hitMax: false, index: 1, length: 5 },
      ];
    });

    it('should update slot at valid index', () => {
      (spectator as any).updateCurrentLevelSlots('testuser', ['t', 'e', 's', 't'], 0, false);

      expect(spectator.currentLevelSlots[0]).toEqual({
        letters: ['t', 'e', 's', 't'],
        word: 'test',
        user: 'testuser',
        hitMax: false,
        index: 0,
        length: 4
      });
    });

    it('should handle hitMax flag correctly', () => {
      (spectator as any).updateCurrentLevelSlots('testuser', ['w', 'o', 'r', 'd'], 1, true);

      expect(spectator.currentLevelSlots[1].hitMax).toBe(true);
    });

    it('should not update slot at invalid index', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

      (spectator as any).updateCurrentLevelSlots('testuser', ['t', 'e', 's', 't'], 5, false);

      expect(consoleSpy).toHaveBeenCalledWith('Invalid index 5 for current level slots');
      consoleSpy.mockRestore();
    });
  });

  describe('updateCorrectWordsDisplayed', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
    });

    it('should add word to correct words list', () => {
      (spectator as any).updateCorrectWordsDisplayed('test');

      expect(spectator.currentLevelCorrectWords).toContain('test');
    });

    it('should sort words by length then alphabetically', () => {
      (spectator as any).updateCorrectWordsDisplayed('word');
      (spectator as any).updateCorrectWordsDisplayed('test');
      (spectator as any).updateCorrectWordsDisplayed('ab');
      (spectator as any).updateCorrectWordsDisplayed('longer');

      expect(spectator.currentLevelCorrectWords).toEqual(['ab', 'test', 'word', 'longer']);
    });

    it('should place missing words (marked with *) after regular words of same length', () => {
      (spectator as any).updateCorrectWordsDisplayed('test');
      (spectator as any).updateCorrectWordsDisplayed('word*');
      (spectator as any).updateCorrectWordsDisplayed('best');

      const fourLetterWords = spectator.currentLevelCorrectWords.filter(w => w.replace('*', '').length === 4);
      expect(fourLetterWords[fourLetterWords.length - 1]).toBe('word*');
    });

    it('should update DOM with grouped words', () => {
      (spectator as any).updateCorrectWordsDisplayed('test');
      (spectator as any).updateCorrectWordsDisplayed('word');
      (spectator as any).updateCorrectWordsDisplayed('ab');

      const logEl = document.getElementById('correct-words-log')!;
      expect(logEl.innerHTML).toContain('2:'); // 2-letter group
      expect(logEl.innerHTML).toContain('4:'); // 4-letter group
    });
  });

  describe('calculateHiddenLetters', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
    });

    it('should identify hidden letters not in current level letters', () => {
      spectator.currentLevelLetters = ['t', 'e', 's'];

      (spectator as any).calculateHiddenLetters('t e s t i n g');

      const hiddenEl = document.getElementById('hidden-letter')!;
      expect(hiddenEl.innerText).toContain('I');
      expect(hiddenEl.innerText).toContain('N');
      expect(hiddenEl.innerText).toContain('G');
    });

    it('should handle duplicate letters correctly', () => {
      spectator.currentLevelLetters = ['t', 'e', 's'];

      (spectator as any).calculateHiddenLetters('t e s t t');

      const hiddenEl = document.getElementById('hidden-letter')!;
      expect(hiddenEl.innerText).toContain('T');
    });

    it('should not update UI if all letters are present', () => {
      spectator.currentLevelLetters = ['t', 'e', 's', 't'];

      (spectator as any).calculateHiddenLetters('t e s t');

      const hiddenEl = document.getElementById('hidden-letter')!;
      expect(hiddenEl.innerText).toBe('');
    });
  });

  describe('calculateFakeLetters', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
    });

    it('should identify fake letters not in big word', () => {
      spectator.currentLevelLetters = ['t', 'e', 's', 't', 'x', 'y'];

      (spectator as any).calculateFakeLetters('t e s t');

      const fakeEl = document.getElementById('fake-letter')!;
      expect(fakeEl.innerText).toContain('X');
      expect(fakeEl.innerText).toContain('Y');
    });

    it('should not include question marks as fake letters', () => {
      spectator.currentLevelLetters = ['t', 'e', 's', '?'];

      (spectator as any).calculateFakeLetters('t e s t');

      const fakeEl = document.getElementById('fake-letter')!;
      expect(fakeEl.innerText).not.toContain('?');
    });
  });

  describe('log', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
    });

    it('should append message to specified log element', () => {
      spectator.log('Test message', 'wos-game-log');

      const logEl = document.getElementById('wos-game-log')!;
      expect(logEl.innerText).toContain('Test message');
    });

    it('should handle object messages by stringifying them', () => {
      spectator.log({ key: 'value' } as any, 'wos-game-log');

      const logEl = document.getElementById('wos-game-log')!;
      expect(logEl.innerText).toContain('"key"');
      expect(logEl.innerText).toContain('"value"');
    });

    it('should scroll to bottom after adding message', () => {
      const logEl = document.getElementById('wos-game-log')!;
      Object.defineProperty(logEl, 'scrollHeight', { value: 1000, writable: true });

      spectator.log('Test message', 'wos-game-log');

      expect(logEl.scrollTop).toBe(1000);
    });
  });

  describe('logEmptySlots', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
    });

    it('should count empty slots by length', () => {
      spectator.currentLevelSlots = [
        { letters: ['a', 'b'], word: 'ab', user: undefined, hitMax: false, index: 0, length: 4 },
        { letters: ['a', 'b', 'c'], word: 'abc', user: undefined, hitMax: false, index: 1, length: 4 },
        { letters: ['a', 'b', 'c', 'd'], word: 'abcd', user: 'user1', hitMax: false, index: 2, length: 4 },
      ];

      (spectator as any).logEmptySlots();

      expect(spectator.currentLevelEmptySlotsCount[2]).toBe(1);
      expect(spectator.currentLevelEmptySlotsCount[3]).toBe(1);
    });

    it('should not count slots with users', () => {
      spectator.currentLevelSlots = [
        { letters: ['a', 'b'], word: 'ab', user: 'user1', hitMax: false, index: 0, length: 4 },
        { letters: ['a', 'b', 'c'], word: 'abc', user: 'user2', hitMax: false, index: 1, length: 4 },
      ];

      (spectator as any).logEmptySlots();

      expect(Object.keys(spectator.currentLevelEmptySlotsCount).length).toBe(0);
    });
  });

  describe('connectToWosGame', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
    });

    it('should not connect with invalid mirror URL', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

      spectator.connectToWosGame('invalid-url');

      expect(spectator.wosSocket).toBeNull();

      consoleErrorSpy.mockRestore();
    });

    it('should disconnect existing socket before connecting', () => {
      const mockSocket = {
        disconnect: vi.fn(),
        on: vi.fn(),
      };
      spectator.wosSocket = mockSocket;

      spectator.connectToWosGame('https://wos2.gartic.es/r/ABC123');

      expect(mockSocket.disconnect).toHaveBeenCalled();
    });
  });

  describe('connectToTwitch', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
    });

    it('should add # prefix if not present', () => {
      spectator.connectToTwitch('testchannel');

      expect(spectator.currentChannel).toBe('testchannel');
    });

    it('should not duplicate # prefix', () => {
      spectator.connectToTwitch('#testchannel');

      expect(spectator.currentChannel).toBe('testchannel');
    });

    it('should load channel records on connect', () => {
      mockLocalStorage.setItem('pb_testchannel', '10');

      spectator.connectToTwitch('testchannel');

      expect(spectator.personalBest).toBe(10);
    });
  });

  describe('disconnect', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
    });

    it('should disconnect socket if connected', () => {
      const mockSocket = {
        disconnect: vi.fn(),
      };
      spectator.wosSocket = mockSocket;

      spectator.disconnect();

      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(spectator.wosSocket).toBeNull();
    });

    it('should handle null socket gracefully', () => {
      spectator.wosSocket = null;

      expect(() => spectator.disconnect()).not.toThrow();
    });
  });

  describe('disconnectTwitch', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
    });

    it('should close twitch client if connected', () => {
      const mockClient = {
        close: vi.fn(),
      };
      spectator.twitchClient = mockClient as any;

      spectator.disconnectTwitch();

      expect(mockClient.close).toHaveBeenCalled();
      expect(spectator.twitchClient).toBeUndefined();
    });

    it('should handle undefined client gracefully', () => {
      spectator.twitchClient = undefined;

      expect(() => spectator.disconnectTwitch()).not.toThrow();
    });
  });

  describe('handleGameInitialization', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
    });

    it('should set current level from event data', () => {
      const slots = [
        { letters: ['t', 'e', 's', 't'], word: '', hitMax: false, index: 0, length: 4 }
      ];

      (spectator as any).handleGameInitialization(10, 1, ['a', 'b', 'c'], slots);

      expect(spectator.currentLevel).toBe(10);
    });

    it('should update current level slots', () => {
      const slots = [
        { letters: ['t', 'e', 's', 't'], word: '', hitMax: false, index: 0, length: 4 }
      ];

      (spectator as any).handleGameInitialization(5, 1, ['a', 'b', 'c'], slots);

      expect(spectator.currentLevelSlots).toEqual(slots);
    });

    it('should clear board when event type is 1 (Level Started)', () => {
      spectator.currentLevelCorrectWords = ['word1', 'word2'];
      const slots = [];

      (spectator as any).handleGameInitialization(1, 1, ['a', 'b', 'c'], slots);

      expect(spectator.currentLevelCorrectWords).toEqual([]);
    });

    it('should not clear board when event type is 12 (Game Connected)', () => {
      spectator.currentLevelCorrectWords = ['word1', 'word2'];
      const slots = [];

      (spectator as any).handleGameInitialization(5, 12, ['a', 'b', 'c'], slots);

      // Board should not be cleared for event type 12
      expect(spectator.currentLevelCorrectWords).toEqual(['word1', 'word2']);
    });

    it('should update UI elements with level', () => {
      (spectator as any).handleGameInitialization(15, 1, ['a', 'b', 'c'], []);

      expect(document.getElementById('level-value')!.innerText).toBe('15');
      expect(document.getElementById('level-title')!.innerText).toBe('LEVEL');
    });

    it('should update UI with letters when provided', () => {
      (spectator as any).handleGameInitialization(5, 1, ['a', 'b', 'c'], []);

      expect(spectator.currentLevelLetters).toEqual(['a', 'b', 'c']);
      expect(document.getElementById('letters')!.innerText).toBe('A B C');
    });
  });

  describe('handleLevelResults', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
      spectator.currentLevel = 10;
      spectator.clearSoundEnabled = false; // Disable sound for tests
      (spectator as any).loadChannelRecords('testchannel');
    });

    it('should increment level by number of stars', async () => {
      await (spectator as any).handleLevelResults(5);

      expect(spectator.currentLevel).toBe(15);
    });

    it('should update daily record if level increases', async () => {
      spectator.dailyBest = 10;

      await (spectator as any).handleLevelResults(5);

      expect(spectator.dailyBest).toBe(15);
    });

    it('should update UI to show next level', async () => {
      await (spectator as any).handleLevelResults(3);

      expect(document.getElementById('level-title')!.innerText).toBe('NEXT LEVEL');
      expect(document.getElementById('level-value')!.innerText).toBe('13');
    });

    it('should record board clear on 5-star completion', async () => {
      spectator.dailyClears = 2;
      spectator.currentLevelSlots = [
        { letters: ['t', 'e', 's', 't'], word: 'test', user: 'user1', hitMax: false, index: 0, length: 4 }
      ];

      await (spectator as any).handleLevelResults(5);

      expect(spectator.dailyClears).toBe(3);
    });

    it('should record board clear when all slots filled', async () => {
      spectator.dailyClears = 2;
      spectator.currentLevelSlots = [
        { letters: ['t', 'e', 's', 't'], word: 'test', user: 'user1', hitMax: false, index: 0, length: 4 },
        { letters: ['w', 'o', 'r', 'd'], word: 'word', user: 'user2', hitMax: false, index: 1, length: 4 }
      ];

      await (spectator as any).handleLevelResults(3);

      expect(spectator.dailyClears).toBe(3);
    });

    it('should not record clear if slots are incomplete', async () => {
      spectator.dailyClears = 2;
      spectator.currentLevelSlots = [
        { letters: ['t', 'e', 's', 't'], word: 'test', user: 'user1', hitMax: false, index: 0, length: 4 },
        { letters: ['w', 'o', 'r', 'd'], word: 'word', user: undefined, hitMax: false, index: 1, length: 4 }
      ];

      await (spectator as any).handleLevelResults(3);

      expect(spectator.dailyClears).toBe(2);
    });
  });

  describe('handleLevelEnd', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
      spectator.currentLevel = 15;
    });

    it('should log game ended message', () => {
      const logSpy = vi.spyOn(spectator, 'log');

      (spectator as any).handleLevelEnd();

      expect(logSpy).toHaveBeenCalledWith(
        'Game Ended on Level 15',
        spectator.wosGameLogId
      );
    });
  });

  describe('handleLetterReveal', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
    });

    it('should update fake letter display', () => {
      (spectator as any).handleLetterReveal(['a'], ['x', 'y']);

      expect(document.getElementById('fake-letter')!.innerText).toBe('X Y');
    });

    it('should update hidden letter display', () => {
      (spectator as any).handleLetterReveal(['a', 'b'], ['x']);

      expect(document.getElementById('hidden-letter')!.innerText).toBe('A B');
    });

    it('should not update displays if arrays are empty', () => {
      (spectator as any).handleLetterReveal([], []);

      expect(document.getElementById('fake-letter')!.innerText).toBe('');
      expect(document.getElementById('hidden-letter')!.innerText).toBe('');
    });

    it('should update current level letters when big word is not set', () => {
      spectator.currentLevelBigWord = '';
      spectator.currentLevelLetters = ['t', 'e', 's', '?', 'x'];

      (spectator as any).handleLetterReveal(['a'], ['x']);

      expect(spectator.currentLevelLetters).toContain('a');
      expect(spectator.currentLevelLetters).not.toContain('x');
      expect(spectator.currentLevelLetters).not.toContain('?');
    });
  });

  describe('handleCorrectGuess', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
      spectator.currentLevelSlots = [
        { letters: [], word: '', hitMax: false, index: 0, length: 4 }
      ];
    });

    it('should update game state after delay', async () => {
      spectator.twitchChatLog.set('testuser', {
        message: 'test',
        timestamp: Date.now()
      });

      const updateSpy = vi.spyOn(spectator as any, 'updateGameState');

      await (spectator as any).handleCorrectGuess('testuser', ['t', 'e', 's', 't'], 0, false);

      expect(updateSpy).toHaveBeenCalledWith('testuser', ['t', 'e', 's', 't'], 0, false);
    }, 10000);
  });

  describe('logMissingWords', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
      spectator.currentLevelCorrectWords = ['test', 'word'];
    });

    it('should call findAllMissingWords using big word when available and render returned missing words', async () => {
      const dbService = await import('@scripts/db-service');
      const fetchBoardMock = vi.mocked(dbService.fetchBoard);
      fetchBoardMock.mockResolvedValueOnce(null); // Board not found, falls back to dictionary
      
      const findAllMissingWordsMock = vi.mocked(wosWords.findAllMissingWords);
      findAllMissingWordsMock.mockImplementationOnce((knownWords: string[], knownLetters: string, minLength: number) => {
        // Snapshot the args at call time (the array is later mutated by UI updates).
        expect([...knownWords]).toEqual(['test', 'word']);
        expect(knownLetters).toBe('T E S T I N G');
        expect(minLength).toBe(4);
        return ['alpha', 'beta'];
      });

      spectator.currentLevelBigWord = 'T E S T I N G';
      spectator.currentLevelLetters = ['t', 'e', 's', 't'];
      spectator.currentLevelSlots = [
        { letters: ['.', '.', '.', '.'], word: '', hitMax: false, index: 0, length: 4 },
        { letters: ['.', '.', '.', '.', '.'], word: '', hitMax: false, index: 1, length: 5 },
      ];

      await (spectator as any).logMissingWords();

      expect(fetchBoardMock).toHaveBeenCalledWith('T E S T I N G');
      expect(findAllMissingWordsMock).toHaveBeenCalledTimes(1);
      expect(spectator.currentLevelCorrectWords).toEqual(
        expect.arrayContaining(['alpha*', 'beta*'])
      );
      expect(document.getElementById('correct-words-log')!.innerHTML).toContain('*');
    });

    it('should call findAllMissingWords using currentLevelLetters when big word is not set', async () => {
      const findAllMissingWordsMock = vi.mocked(wosWords.findAllMissingWords);
      findAllMissingWordsMock.mockReturnValueOnce([]);

      spectator.currentLevelBigWord = '';
      spectator.currentLevelLetters = ['t', 'e', '?', 's', 't'];
      spectator.currentLevelSlots = [
        { letters: ['.', '.', '.', '.'], word: '', hitMax: false, index: 0, length: 4 },
      ];

      await (spectator as any).logMissingWords();

      expect(findAllMissingWordsMock).toHaveBeenCalledWith(
        spectator.currentLevelCorrectWords,
        'test',
        4
      );
    });

    it('should compute minLength from currentLevelSlots when present', async () => {
      const findAllMissingWordsMock = vi.mocked(wosWords.findAllMissingWords);
      findAllMissingWordsMock.mockReturnValueOnce([]);

      spectator.currentLevelBigWord = '';
      spectator.currentLevelLetters = ['t', 'e', 's', 't'];
      spectator.currentLevelSlots = [
        { letters: ['.', '.'], word: '', hitMax: false, index: 0, length: 2 },
        { letters: ['.', '.', '.', '.'], word: '', hitMax: false, index: 1, length: 4 },
      ];

      await (spectator as any).logMissingWords();

      expect(findAllMissingWordsMock).toHaveBeenCalledWith(
        spectator.currentLevelCorrectWords,
        'test',
        2
      );
    });
  });

  describe('worker routing (startEventProcessors)', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
    });

    it('should route twitch worker messages into twitchChatLog + UI log', () => {
      const twitchWorker = findWorkerByUrlSubstring('twitch-chat-worker');
      expect(twitchWorker).toBeTruthy();

      twitchWorker.emitMessage({
        type: 'twitch_message',
        username: 'someuser',
        message: 'test',
        timestamp: 123,
      });

      expect(spectator.twitchChatLog.get('someuser')).toEqual({
        message: 'test',
        timestamp: 123,
      });
      expect(document.getElementById('twitch-chat-log')!.innerText).toContain(
        '[Twitch Chat] someuser: test'
      );
    });

    it('should apply record updates from wos worker event payload', async () => {
      const wosWorker = findWorkerByUrlSubstring('wos-worker');
      expect(wosWorker).toBeTruthy();

      (spectator as any).pbStorageKey = 'pb_testchannel';
      spectator.personalBest = 0;

      await wosWorker.emitMessage({
        type: 'wos_event',
        wosEventType: 12,
        wosEventName: 'Game Connected',
        username: '',
        letters: [],
        hitMax: false,
        stars: 0,
        level: 1,
        falseLetters: [],
        hiddenLetters: [],
        slots: [],
        index: 0,
        record: 42,
      });

      expect(spectator.personalBest).toBe(42);
      expect(mockLocalStorage.getItem('pb_testchannel')).toBe('42');
      expect(document.getElementById('pb-value')!.innerText).toBe('42');
    });

    it('should route wos letter reveal events to update displays', async () => {
      const wosWorker = findWorkerByUrlSubstring('wos-worker');
      expect(wosWorker).toBeTruthy();

      spectator.currentLevelBigWord = '';
      spectator.currentLevelLetters = ['t', '?', 'x'];

      await wosWorker.emitMessage({
        type: 'wos_event',
        wosEventType: 10,
        wosEventName: 'Hidden/Fake Letters Revealed',
        username: '',
        letters: [],
        hitMax: false,
        stars: 0,
        level: 1,
        falseLetters: ['x'],
        hiddenLetters: ['a'],
        slots: [],
        index: 0,
      });

      expect(document.getElementById('hidden-letter')!.innerText).toBe('A');
      expect(document.getElementById('fake-letter')!.innerText).toBe('X');
      expect(spectator.currentLevelLetters).toEqual(expect.arrayContaining(['t', 'a']));
      expect(spectator.currentLevelLetters).not.toContain('x');
      expect(spectator.currentLevelLetters).not.toContain('?');
    });

    it('should route correct-guess events through delay and update slots', async () => {
      const wosWorker = findWorkerByUrlSubstring('wos-worker');
      expect(wosWorker).toBeTruthy();

      // Ensure updateGameState can resolve the hidden word via lastTwitchMessage.
      (spectator as any).lastTwitchMessage = {
        username: 'TestUser',
        message: 'test',
        timestamp: Date.now(),
      };
      spectator.currentLevelSlots = [
        { letters: [], word: '', hitMax: false, index: 0, length: 4 },
      ];

      vi.useFakeTimers();
      const p = wosWorker.emitMessage({
        type: 'wos_event',
        wosEventType: 3,
        wosEventName: 'Correct Guess',
        username: 'TestUser',
        letters: ['t', 'e', 's', 't'],
        hitMax: false,
        stars: 0,
        level: 1,
        falseLetters: [],
        hiddenLetters: [],
        slots: [],
        index: 0,
      });

      // Default delay is 400ms when import.meta.env is not set.
      vi.advanceTimersByTime(500);
      await p;
      vi.useRealTimers();

      expect(spectator.currentLevelCorrectWords).toEqual(expect.arrayContaining(['test']));
      expect(spectator.currentLevelSlots[0].word).toBe('test');
      expect(spectator.currentLevelSlots[0].user).toBe('TestUser');
    });
  });

  describe('updateGameState', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
      spectator.currentLevelSlots = [
        { letters: [], word: '', hitMax: false, index: 0, length: 4 }
      ];
    });

    it('should use twitch message for word when available', () => {
      spectator.lastTwitchMessage = {
        username: 'testuser',
        message: 'test',
        timestamp: Date.now()
      };

      (spectator as any).updateGameState('testuser', ['t', 'e', 's', 't'], 0, false);

      expect(spectator.currentLevelCorrectWords).toContain('test');
    });

    it('should fall back to chat log when last message not matching', () => {
      spectator.lastTwitchMessage = {
        username: 'otheruser',
        message: 'other',
        timestamp: Date.now()
      };
      spectator.twitchChatLog.set('testuser', {
        message: 'test',
        timestamp: Date.now()
      });

      (spectator as any).updateGameState('testuser', ['t', 'e', 's', 't'], 0, false);

      expect(spectator.currentLevelCorrectWords).toContain('test');
    });

    it('should return early if no matching message found', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

      (spectator as any).updateGameState('testuser', ['t', 'e', 's', 't'], 0, false);

      expect(warnSpy).toHaveBeenCalled();
      expect(spectator.currentLevelCorrectWords).toEqual([]);
      warnSpy.mockRestore();
    });

    it('should set big word when hitMax is true', () => {
      spectator.lastTwitchMessage = {
        username: 'testuser',
        message: 'testing',
        timestamp: Date.now()
      };

      (spectator as any).updateGameState('testuser', ['t', 'e', 's', 't', 'i', 'n', 'g'], 0, true);

      expect(spectator.currentLevelBigWord).toBe('T E S T I N G');
      expect(document.getElementById('letters-label')!.innerText).toBe('Big Word:');
    });
  });
});
