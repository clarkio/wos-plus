import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import tmi from '@tmi.js/chat';
import { GameSpectator } from '@scripts/wos-plus-main';
import * as wosWords from '@scripts/wos-words';
import { fetchChannelStats } from '@scripts/db-service';

// Mock the worker modules
vi.mock('@scripts/wos-worker', () => ({
  default: {}
}));

vi.mock('@scripts/twitch-chat-worker', () => ({
  default: {}
}));

// Mock the wos-words module
vi.mock('@scripts/wos-words', async (importActual) => {
  const actual = await importActual<typeof import('@scripts/wos-words')>();
  return {
    findAllMissingWords: vi.fn(() => []),
    findMissingWordsFromBoard: vi.fn(() => []),
    loadWordsFromDb: vi.fn(),
    // Default to "unknown word" so hidden-word resolution falls back to its
    // length/recency heuristic. Individual tests override this to exercise the
    // dictionary-preference path.
    isWosWord: vi.fn(() => false),
    // Keep the real letter-fit check: it's a pure function with no dictionary
    // dependency, so hidden-word resolution genuinely validates that a candidate
    // fits within the level's letters.
    canFormWord: actual.canFormWord,
  };
});

// Mock the db-service module
vi.mock('@scripts/db-service', () => ({
  saveBoard: vi.fn(),
  fetchBoard: vi.fn(),
  fetchChannelStats: vi.fn().mockResolvedValue({ allTimePersonalBest: 0, dailyBest: 0, dailyClears: 0, chatbotEnabled: false }),
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

// The DOM elements the spectator reads/writes. The test harness builds these
// programmatically (see buildTestDom) rather than assigning an HTML string to
// document.body.innerHTML.
const TEST_DOM_IDS = [
  'pb-record',
  'daily-pb-record',
  'daily-clear-record',
  'pb-value',
  'daily-pb-value',
  'daily-clear-value',
  'level-title',
  'level-value',
  'letters',
  'letters-label',
  'hidden-letter',
  'fake-letter',
  'correct-words-log',
  'wos-game-log',
  'twitch-chat-log',
];

// Build a fresh set of empty <div> elements the spectator expects to find.
const buildTestDom = () => {
  document.body.replaceChildren();
  for (const id of TEST_DOM_IDS) {
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }
};

// A valid Words on Stream mirror URL: official host + UUID game id.
const VALID_MIRROR_URL = 'https://wos.gg/r/4fdfc856-0328-4384-a882-8377dcb5a4f6';
const VALID_GAME_ID = '4fdfc856-0328-4384-a882-8377dcb5a4f6';

// Seed a chat message into the spectator's per-user history exactly the way the
// Twitch worker routing does, so hidden-word resolution can be exercised.
const seedChat = (
  spectator: GameSpectator,
  username: string,
  message: string,
  timestamp = Date.now()
) => {
  (spectator as any).recordChatMessage(username, message, timestamp);
};

describe('GameSpectator class', () => {
  let spectator: GameSpectator;

  const getMockWorkers = (): any[] => ((global as any).MockWorker?.instances ?? []);
  const findWorkerByUrlSubstring = (substr: string) =>
    getMockWorkers().find((w) => typeof w.url === 'string' && w.url.includes(substr));

  beforeEach(() => {
    buildTestDom();

    // Mock Audio as a real constructor so `new Audio(src)` works.
    // vi.fn rejects arrow-function implementations when invoked with `new`.
    (global as any).Audio = vi.fn(function (this: any, src?: string) {
      this.src = src;
      this.play = vi.fn().mockResolvedValue(undefined);
    });

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
      expect(spectator.isSoundsEnabled).toBe(true);
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

  describe('getMirrorCode', () => {
    it('should extract game code from valid mirror URL', () => {
      spectator = new GameSpectator();

      const code = spectator.getMirrorCode(VALID_MIRROR_URL);

      expect(code).toBe(VALID_GAME_ID);
    });

    it('should return null for a non-mirror path', () => {
      spectator = new GameSpectator();

      const code = spectator.getMirrorCode('https://wos.gg/invalid');

      expect(code).toBeNull();
    });

    it('should return null for malformed URL', () => {
      spectator = new GameSpectator();

      const code = spectator.getMirrorCode('not-a-valid-url');

      expect(code).toBeNull();
    });
  });

  describe('loadChannelRecords', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
    });

    it('should load stats from database via fetchChannelStats', async () => {
      vi.mocked(fetchChannelStats).mockResolvedValueOnce({
        allTimePersonalBest: 15,
        dailyBest: 10,
        dailyClears: 3,
        chatbotEnabled: true,
      });

      await (spectator as any).loadChannelRecords('testchannel');

      expect(fetchChannelStats).toHaveBeenCalledWith('testchannel');
      expect(spectator.personalBest).toBe(15);
      expect(spectator.dailyBest).toBe(10);
      expect(spectator.dailyClears).toBe(3);
    });

    it('should default to 0 if no stats exist', async () => {
      vi.mocked(fetchChannelStats).mockResolvedValueOnce({
        allTimePersonalBest: 0,
        dailyBest: 0,
        dailyClears: 0,
        chatbotEnabled: false,
      });

      await (spectator as any).loadChannelRecords('newchannel');

      expect(spectator.personalBest).toBe(0);
      expect(spectator.dailyBest).toBe(0);
      expect(spectator.dailyClears).toBe(0);
    });

    it('should update UI with loaded values', async () => {
      vi.mocked(fetchChannelStats).mockResolvedValueOnce({
        allTimePersonalBest: 20,
        dailyBest: 15,
        dailyClears: 5,
        chatbotEnabled: true,
      });

      await (spectator as any).loadChannelRecords('testchannel');

      expect(document.getElementById('pb-value')!.innerText).toBe('20');
      expect(document.getElementById('daily-pb-value')!.innerText).toBe('15');
      expect(document.getElementById('daily-clear-value')!.innerText).toBe('5');
    });

    it('should hide the daily best and daily clears badges when the chatbot is not enabled', async () => {
      vi.mocked(fetchChannelStats).mockResolvedValueOnce({
        allTimePersonalBest: 20,
        dailyBest: 0,
        dailyClears: 0,
        chatbotEnabled: false,
      });

      await (spectator as any).loadChannelRecords('nochatbot');

      expect(spectator.chatbotEnabled).toBe(false);
      // All-time best is always shown; daily best/clears are hidden (issue #79).
      expect(document.getElementById('pb-record')!.style.display).toBe('');
      expect(document.getElementById('daily-pb-record')!.style.display).toBe('none');
      expect(document.getElementById('daily-clear-record')!.style.display).toBe('none');
    });

    it('should show the daily best and daily clears badges when the chatbot is enabled', async () => {
      // Start hidden to prove the badges are re-shown for a chatbot-enabled channel.
      document.getElementById('daily-pb-record')!.style.display = 'none';
      document.getElementById('daily-clear-record')!.style.display = 'none';

      vi.mocked(fetchChannelStats).mockResolvedValueOnce({
        allTimePersonalBest: 20,
        dailyBest: 15,
        dailyClears: 5,
        chatbotEnabled: true,
      });

      await (spectator as any).loadChannelRecords('haschatbot');

      expect(spectator.chatbotEnabled).toBe(true);
      expect(document.getElementById('pb-record')!.style.display).toBe('');
      expect(document.getElementById('daily-pb-record')!.style.display).toBe('');
      expect(document.getElementById('daily-clear-record')!.style.display).toBe('');
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
      seedChat(spectator, 'user1', 'test');

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
      expect(logEl.textContent).toContain('2:'); // 2-letter group
      expect(logEl.textContent).toContain('4:'); // 4-letter group
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
      // Big word has 3 Ts; level letters has 1 T -> 2 hidden Ts.
      expect(hiddenEl.innerText).toBe('T T');
    });

    it('should report multiple hidden instances of the same letter (CIRCLES regression #83)', () => {
      // Scenario from issue #83: CIRCLES board with two unrevealed Cs.
      // Level letters typically present as I R L E S with two ? placeholders
      // for the two hidden Cs.
      spectator.currentLevelLetters = ['i', 'r', 'l', 'e', 's', '?', '?'];

      (spectator as any).calculateHiddenLetters('c i r c l e s');

      const hiddenEl = document.getElementById('hidden-letter')!;
      // Two Cs are hidden - both should be reported, not just one.
      const cCount = (hiddenEl.innerText.match(/C/g) || []).length;
      expect(cCount).toBe(2);
    });

    it('should report two distinct hidden letters from CIRCLES (C and R hidden)', () => {
      // CIRCLES with one C visible and the second C + R hidden.
      // bigWord: c i r c l e s -> {c:2, i:1, r:1, l:1, e:1, s:1}
      // level:   c i l e s ? ?  -> {c:1, i:1, l:1, e:1, s:1}
      // missing: c (2-1=1), r (1-0=1) -> "C R"
      spectator.currentLevelLetters = ['c', 'i', 'l', 'e', 's', '?', '?'];

      (spectator as any).calculateHiddenLetters('c i r c l e s');

      const hiddenEl = document.getElementById('hidden-letter')!;
      expect(hiddenEl.innerText).toBe('C R');
    });

    it('should display all hidden letters when one was already discovered via dictionary detection (ADMIRE regression)', () => {
      // Scenario reported in follow-up to #83:
      // Initial board: R ? E D Q F ? I (hidden = A and M, fake = Q and F)
      // Big word ADMIRE is guessed.
      // Earlier in the level, dictionary-based detection identified one hidden
      // letter (M) and merged it into currentLevelLetters via the partial
      // replacement branch, recording it in currentLevelHiddenLetters.
      spectator.currentLevelLetters = ['r', 'm', 'e', 'd', 'q', 'f', '?', 'i'];
      spectator.currentLevelHiddenLetters = ['m'];

      (spectator as any).calculateHiddenLetters('a d m i r e');

      const hiddenEl = document.getElementById('hidden-letter')!;
      // Both M (previously discovered) and A (newly discovered) must show.
      expect(hiddenEl.innerText.split(' ').sort()).toEqual(['A', 'M']);
    });

    it('should display all hidden letters when both were already discovered (ADMIRE all-pre-discovered)', () => {
      // Dictionary path detected both A and M before the big word was guessed
      // and replaced both ? slots in currentLevelLetters with the discovered
      // letters (the new consistent invariant).
      spectator.currentLevelLetters = ['r', 'a', 'e', 'd', 'q', 'f', 'm', 'i'];
      spectator.currentLevelHiddenLetters = ['a', 'm'];

      (spectator as any).calculateHiddenLetters('a d m i r e');

      const hiddenEl = document.getElementById('hidden-letter')!;
      expect(hiddenEl.innerText.split(' ').sort()).toEqual(['A', 'M']);
    });

    it('should display all hidden letters when none were pre-discovered (ADMIRE clean state)', () => {
      // No dictionary detection happened before the big word was found.
      spectator.currentLevelLetters = ['r', '?', 'e', 'd', 'q', 'f', '?', 'i'];
      spectator.currentLevelHiddenLetters = [];

      (spectator as any).calculateHiddenLetters('a d m i r e');

      const hiddenEl = document.getElementById('hidden-letter')!;
      expect(hiddenEl.innerText.split(' ').sort()).toEqual(['A', 'M']);
    });

    it('should not update UI if all letters are present', () => {
      spectator.currentLevelLetters = ['t', 'e', 's', 't'];

      (spectator as any).calculateHiddenLetters('t e s t');

      const hiddenEl = document.getElementById('hidden-letter')!;
      expect(hiddenEl.innerText).toBe('');
    });

    it('should be idempotent across multiple calls with the same big word', () => {
      // Regression: calling calculateHiddenLetters twice should not
      // double-record hidden letters in currentLevelHiddenLetters.
      spectator.currentLevelLetters = ['b', 'o', 'm', 'd', 't', 's', '?', '?', '?'];

      (spectator as any).calculateHiddenLetters('B R O O M E D');
      (spectator as any).calculateHiddenLetters('B R O O M E D');

      const hidden = document.getElementById('hidden-letter')!.innerText
        .split(' ')
        .filter(Boolean)
        .sort();
      expect(hidden).toEqual(['E', 'O', 'R']);
      expect(spectator.currentLevelHiddenLetters.length).toBe(3);
    });

    it('should not duplicate hidden letters across multiple anagram big-word hits (BROOMED/BEDROOM/BOREDOM regression)', () => {
      // Regression: when a level has multiple anagram big words (BROOMED,
      // BEDROOM, BOREDOM are all 7-letter anagrams), each guess fires
      // hitMax=true and triggers calculateHiddenLetters. Without the
      // idempotency guard, each invocation re-pushed the same hidden
      // letters onto currentLevelHiddenLetters. Previously this produced
      // a 9-letter display like "E R O O R E R O E" instead of "E R O".
      spectator.currentLevelLetters = ['b', 'o', 'm', 'd', 't', 's', '?', '?', '?'];

      (spectator as any).calculateHiddenLetters('B E D R O O M');
      (spectator as any).calculateHiddenLetters('B O R E D O M');
      (spectator as any).calculateHiddenLetters('B R O O M E D');

      const hidden = document.getElementById('hidden-letter')!.innerText
        .split(' ')
        .filter(Boolean)
        .sort();
      expect(hidden).toEqual(['E', 'O', 'R']);
      expect(spectator.currentLevelHiddenLetters.length).toBe(3);
    });

    it('should replace ? slots in currentLevelLetters with discovered hidden letters', () => {
      // Convention shared with the dictionary detection branch: discovered
      // hidden letters get merged into currentLevelLetters so the board
      // stays a consistent source of truth.
      spectator.currentLevelLetters = ['b', 'o', 'm', 'd', 't', 's', '?', '?', '?'];

      (spectator as any).calculateHiddenLetters('B R O O M E D');

      // No ? slots should remain after a successful big-word discovery.
      expect(spectator.currentLevelLetters).not.toContain('?');
      // The merged board should account for all big-word letters.
      const merged = spectator.currentLevelLetters.map(l => l.toLowerCase()).sort();
      expect(merged).toEqual(['b', 'd', 'e', 'm', 'o', 'o', 'r', 's', 't']);
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
      spectator.connectToWosGame('invalid-url');

      expect(spectator.wosSocket).toBeNull();
    });

    it('should disconnect existing socket before connecting', () => {
      const mockSocket = {
        disconnect: vi.fn(),
        on: vi.fn(),
      };
      spectator.wosSocket = mockSocket;

      spectator.connectToWosGame(VALID_MIRROR_URL);

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

    it('should load channel records on connect', async () => {
      vi.mocked(fetchChannelStats).mockResolvedValueOnce({
        allTimePersonalBest: 10,
        dailyBest: 5,
        dailyClears: 2,
        chatbotEnabled: true,
      });

      spectator.connectToTwitch('testchannel');

      // loadChannelRecords is async, wait for it to complete
      await vi.waitFor(() => {
        expect(spectator.personalBest).toBe(10);
      });
    });

    it('registers an error handler so library errors are not left unhandled', () => {
      // A missing 'error' listener is what let the transient "Failed to join
      // channel" timeout leak out as an unhandled error (and flood Sentry).
      spectator.connectToTwitch('testchannel');

      const onMock = (spectator.twitchClient as any).on as ReturnType<typeof vi.fn>;
      const events = onMock.mock.calls.map((call: any[]) => call[0]);
      expect(events).toContain('error');
      expect(events).toContain('connect');
    });

    it('does not auto-join via the constructor (joins are managed manually)', () => {
      // Passing `channels` would re-enable the library's auto-join, whose
      // failure path emits the unhandled error we are working around.
      spectator.connectToTwitch('testchannel');

      expect(tmi.Client).toHaveBeenCalledWith({});
    });
  });

  describe('joinTwitchChannel (join retry)', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries the join after a transient failure and stops once it succeeds', async () => {
      vi.useFakeTimers();
      const join = vi
        .fn()
        .mockRejectedValueOnce(new Error('Did not receive command in time'))
        .mockResolvedValueOnce(undefined);
      spectator.twitchClient = { join, close: vi.fn() } as any;
      const token = (spectator as any).twitchJoinToken;

      const pending = (spectator as any).joinTwitchChannel('#testchannel', token);
      await vi.runAllTimersAsync();
      await pending;

      expect(join).toHaveBeenCalledTimes(2);
    });

    it('gives up after the maximum number of attempts', async () => {
      vi.useFakeTimers();
      const join = vi.fn().mockRejectedValue(new Error('Failed to join channel'));
      spectator.twitchClient = { join, close: vi.fn() } as any;
      const token = (spectator as any).twitchJoinToken;

      const pending = (spectator as any).joinTwitchChannel('#testchannel', token);
      await vi.runAllTimersAsync();
      await pending;

      expect(join).toHaveBeenCalledTimes(5);
    });

    it('stops retrying when superseded by a newer connect/disconnect', async () => {
      const join = vi.fn().mockRejectedValue(new Error('Failed to join channel'));
      spectator.twitchClient = { join, close: vi.fn() } as any;
      const token = (spectator as any).twitchJoinToken;
      // Simulate a channel switch / disconnect bumping the token.
      (spectator as any).twitchJoinToken = token + 1;

      await (spectator as any).joinTwitchChannel('#testchannel', token);

      expect(join).not.toHaveBeenCalled();
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
      const slots: any[] = [];

      (spectator as any).handleGameInitialization(1, 1, ['a', 'b', 'c'], slots);

      expect(spectator.currentLevelCorrectWords).toEqual([]);
    });

    it('should not clear board when event type is 12 (Game Connected)', () => {
      spectator.currentLevelCorrectWords = ['word1', 'word2'];
      const slots: any[] = [];

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
      spectator.isSoundsEnabled = false; // Disable sound for tests
    });

    it('should increment level by number of stars', async () => {
      await (spectator as any).handleLevelResults(5);

      expect(spectator.currentLevel).toBe(15);
    });

    it('should update UI to show next level', async () => {
      await (spectator as any).handleLevelResults(3);

      expect(document.getElementById('level-title')!.innerText).toBe('NEXT LEVEL');
      expect(document.getElementById('level-value')!.innerText).toBe('13');
    });
  });

  describe('handleLevelEnd', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
      spectator.currentLevel = 15;
      spectator.isSoundsEnabled = false; // Avoid Audio side-effects in tests
    });

    it('should log game ended message', async () => {
      const logSpy = vi.spyOn(spectator, 'log');

      await (spectator as any).handleLevelEnd();

      expect(logSpy).toHaveBeenCalledWith(
        'Game Ended on Level 15',
        spectator.wosGameLogId
      );
    });

    it('should play the level_end sound when sounds are enabled', async () => {
      spectator.isSoundsEnabled = true;
      const playSoundSpy = vi.spyOn(spectator as any, 'playSound');

      await (spectator as any).handleLevelEnd();

      expect(playSoundSpy).toHaveBeenCalledWith('level_end');
    });
  });

  describe('playSound', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
    });

    it('should not create Audio when sounds are disabled', () => {
      spectator.isSoundsEnabled = false;

      (spectator as any).playSound('level_clear');

      expect((global as any).Audio).not.toHaveBeenCalled();
    });

    it('should construct Audio with the file mapped to the event type', () => {
      spectator.isSoundsEnabled = true;

      (spectator as any).playSound('level_clear');

      expect((global as any).Audio).toHaveBeenCalledWith('/assets/clear.mp3');
    });

    it('should fall back to /assets/nothing.mp3 for unmapped event types', () => {
      spectator.isSoundsEnabled = true;

      (spectator as any).playSound('new_all_time_pb');

      expect((global as any).Audio).toHaveBeenCalledWith('/assets/nothing.mp3');
    });

    it('should call play() on the constructed Audio instance', () => {
      spectator.isSoundsEnabled = true;

      (spectator as any).playSound('one_star');

      const audioMock = (global as any).Audio as ReturnType<typeof vi.fn>;
      const audioInstance = audioMock.mock.instances[audioMock.mock.instances.length - 1];
      expect(audioInstance.play).toHaveBeenCalled();
    });

    it('should not create Audio when the tab is hidden (issue #86)', () => {
      spectator.isSoundsEnabled = true;
      const hiddenSpy = vi
        .spyOn(document, 'hidden', 'get')
        .mockReturnValue(true);

      try {
        (spectator as any).playSound('level_clear');

        expect((global as any).Audio).not.toHaveBeenCalled();
      } finally {
        hiddenSpy.mockRestore();
      }
    });
  });

  describe('handleLevelResults sound effects', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
      spectator.currentLevel = 10;
      spectator.isSoundsEnabled = true;
    });

    it('should play level_clear when stars === 5', async () => {
      const playSoundSpy = vi.spyOn(spectator as any, 'playSound');

      await (spectator as any).handleLevelResults(5);

      expect(playSoundSpy).toHaveBeenCalledWith('level_clear');
    });

    it('should play level_clear when every slot has a user', async () => {
      spectator.currentLevelSlots = [
        { letters: ['t', 'e', 's', 't'], word: 'test', user: 'user1', hitMax: false, index: 0, length: 4 },
        { letters: ['w', 'o', 'r', 'd'], word: 'word', user: 'user2', hitMax: false, index: 1, length: 4 },
      ];
      const playSoundSpy = vi.spyOn(spectator as any, 'playSound');

      await (spectator as any).handleLevelResults(2);

      expect(playSoundSpy).toHaveBeenCalledWith('level_clear');
    });

    it('should play one_star when stars === 1 and not all slots filled', async () => {
      spectator.currentLevelSlots = [
        { letters: ['t', 'e', 's', 't'], word: '', user: undefined, hitMax: false, index: 0, length: 4 },
      ];
      const playSoundSpy = vi.spyOn(spectator as any, 'playSound');

      await (spectator as any).handleLevelResults(1);

      expect(playSoundSpy).toHaveBeenCalledWith('one_star');
      expect(playSoundSpy).not.toHaveBeenCalledWith('level_clear');
    });

    it('should play three_stars when stars === 3 and not all slots filled', async () => {
      spectator.currentLevelSlots = [
        { letters: ['t', 'e', 's', 't'], word: '', user: undefined, hitMax: false, index: 0, length: 4 },
      ];
      const playSoundSpy = vi.spyOn(spectator as any, 'playSound');

      await (spectator as any).handleLevelResults(3);

      expect(playSoundSpy).toHaveBeenCalledWith('three_stars');
      expect(playSoundSpy).not.toHaveBeenCalledWith('level_clear');
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

    it('should not fabricate a duplicate when a revealed letter has no ? slot (issue #85)', () => {
      // CAUTION / REALITY regression: the revealed hidden letter is already
      // present as a visible letter and there is no '?' placeholder for it, so
      // it must NOT be appended a second time.
      spectator.currentLevelBigWord = '';
      spectator.currentLevelLetters = ['c', 'a', 'u', 't', 'i', 'o', 'n'];

      (spectator as any).handleLetterReveal(['c'], []);

      expect(spectator.currentLevelLetters).toEqual(['c', 'a', 'u', 't', 'i', 'o', 'n']);
    });

    it('should be idempotent across repeated/cumulative reveal events (issue #85)', () => {
      // The first reveal fills the '?' slot; a second reveal carrying the same
      // (now slot-less) hidden letter must not add a duplicate.
      spectator.currentLevelBigWord = '';
      spectator.currentLevelLetters = ['c', 'a', 'u', 't', 'i', 'o', '?'];

      (spectator as any).handleLetterReveal(['n'], []);
      expect(spectator.currentLevelLetters).toEqual(['c', 'a', 'u', 't', 'i', 'o', 'n']);

      (spectator as any).handleLetterReveal(['n'], []);
      expect(spectator.currentLevelLetters).toEqual(['c', 'a', 'u', 't', 'i', 'o', 'n']);
    });

    it('should preserve a genuine duplicate hidden letter that has its own ? slot', () => {
      // Boards may legitimately have duplicate valid letters; when the duplicate
      // is hidden it gets its own '?' slot, so the merge must keep both copies.
      spectator.currentLevelBigWord = '';
      spectator.currentLevelLetters = ['t', 'e', 's', '?'];

      (spectator as any).handleLetterReveal(['t'], []);

      expect(spectator.currentLevelLetters).toEqual(['t', 'e', 's', 't']);
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
      seedChat(spectator, 'testuser', 'test');

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
        expect(knownLetters).toBe('TESTING'); // Spaces should be removed
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
      expect(document.getElementById('correct-words-log')!.textContent).toContain('*');
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

    it('should use board data when board is found in database', async () => {
      const dbService = await import('@scripts/db-service');
      const fetchBoardMock = vi.mocked(dbService.fetchBoard);

      // Mock board data from database
      const mockBoard = {
        id: 'TESTING',
        created_at: '2024-01-01T00:00:00Z',
        slots: [
          { letters: ['t', 'e', 's', 't'], word: 'test', user: 'user1', hitMax: false, index: 0, length: 4 },
          { letters: ['w', 'o', 'r', 'd'], word: 'word', user: 'user2', hitMax: false, index: 1, length: 4 },
          { letters: ['m', 'i', 's', 's'], word: 'miss', user: 'user3', hitMax: false, index: 2, length: 4 },
        ]
      };
      fetchBoardMock.mockResolvedValueOnce(mockBoard);

      const findMissingWordsFromBoardMock = vi.mocked(wosWords.findMissingWordsFromBoard);
      findMissingWordsFromBoardMock.mockReturnValueOnce(['miss']);

      spectator.currentLevelBigWord = 'T E S T I N G';
      spectator.currentLevelCorrectWords = ['test', 'word'];
      spectator.currentLevelSlots = [
        { letters: ['t', 'e', 's', 't'], word: 'test', user: 'user1', hitMax: false, index: 0, length: 4 },
        { letters: ['w', 'o', 'r', 'd'], word: 'word', user: 'user2', hitMax: false, index: 1, length: 4 },
        { letters: ['m', 'i', 's', 's'], word: '', user: undefined, hitMax: false, index: 2, length: 4 },
      ];

      await (spectator as any).logMissingWords();

      expect(fetchBoardMock).toHaveBeenCalledWith('T E S T I N G');
      expect(findMissingWordsFromBoardMock).toHaveBeenCalledWith(
        spectator.currentLevelSlots,
        mockBoard.slots
      );
      expect(spectator.currentLevelCorrectWords).toEqual(
        expect.arrayContaining(['miss*'])
      );
    });

    it('should return missed words of all lengths when board not found (spaces in big word)', async () => {
      const dbService = await import('@scripts/db-service');
      const fetchBoardMock = vi.mocked(dbService.fetchBoard);
      fetchBoardMock.mockResolvedValueOnce(null); // Board not found

      const findAllMissingWordsMock = vi.mocked(wosWords.findAllMissingWords);
      // Simulate finding words of different lengths (4, 5, 7 letters)
      findAllMissingWordsMock.mockImplementationOnce((knownWords: string[], knownLetters: string, minLength: number) => {
        // Verify parameters at call time (before array mutations)
        expect([...knownWords]).toEqual(['some']);
        expect(knownLetters).toBe('TESTING'); // Spaces removed!
        expect(minLength).toBe(4);
        return ['test', 'word', 'words', 'testing'];
      });

      spectator.currentLevelBigWord = 'T E S T I N G'; // Has spaces
      spectator.currentLevelCorrectWords = ['some'];
      spectator.currentLevelSlots = [
        { letters: ['.', '.', '.', '.'], word: '', hitMax: false, index: 0, length: 4 },
        { letters: ['.', '.', '.', '.', '.'], word: '', hitMax: false, index: 1, length: 5 },
        { letters: ['.', '.', '.', '.', '.', '.', '.'], word: '', hitMax: false, index: 2, length: 7 },
      ];

      await (spectator as any).logMissingWords();

      // Verify all missed words are displayed
      expect(spectator.currentLevelCorrectWords).toEqual(
        expect.arrayContaining(['test*', 'word*', 'words*', 'testing*'])
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

      // Messages are kept as a per-user history (oldest first) so hidden-word
      // resolution can disambiguate rapid/simultaneous guesses.
      expect(spectator.twitchChatLog.get('someuser')).toEqual([
        { message: 'test', timestamp: 123, consumed: false },
      ]);
      expect(document.getElementById('twitch-chat-log')!.innerText).toContain(
        '[Twitch Chat] someuser: test'
      );
    });

    it('should handle Game Connected event and initialize game state', async () => {
      const wosWorker = findWorkerByUrlSubstring('wos-worker');
      expect(wosWorker).toBeTruthy();

      await wosWorker.emitMessage({
        type: 'wos_event',
        wosEventType: 12,
        wosEventName: 'Game Connected',
        username: '',
        letters: ['a', 'b', 'c'],
        hitMax: false,
        stars: 0,
        level: 5,
        falseLetters: [],
        hiddenLetters: [],
        slots: [{ letters: ['a', 'b'], word: '', hitMax: false, index: 0, length: 4 }],
        index: 0,
      });

      expect(spectator.currentLevel).toBe(5);
      expect(document.getElementById('level-value')!.innerText).toBe('5');
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

      // The word is non-hidden, so it resolves straight from the WoS `letters`
      // with no dependency on chat timing.
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

    it('should let a last-millisecond correct guess process before game-end logic runs', async () => {
      const wosWorker = findWorkerByUrlSubstring('wos-worker');
      expect(wosWorker).toBeTruthy();

      spectator.isSoundsEnabled = false; // Avoid Audio side-effects in tests
      // The buzzer-beater guess is non-hidden, so it resolves from `letters`.
      spectator.currentLevelSlots = [
        { letters: [], word: '', hitMax: false, index: 0, length: 4 },
      ];

      const slotsSpy = vi.spyOn(spectator as any, 'updateCurrentLevelSlots');
      const missingSpy = vi
        .spyOn(spectator as any, 'logMissingWords')
        .mockResolvedValue(undefined);

      vi.useFakeTimers();

      // A correct guess lands at the buzzer, immediately followed by game end.
      const guessP = wosWorker.emitMessage({
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
      const endP = wosWorker.emitMessage({
        type: 'wos_event',
        wosEventType: 5,
        wosEventName: 'Game Ended',
        username: '',
        letters: [],
        hitMax: false,
        stars: 0,
        level: 1,
        falseLetters: [],
        hiddenLetters: [],
        slots: [],
        index: 0,
      });

      await vi.runAllTimersAsync();
      await Promise.all([guessP, endP]);
      vi.useRealTimers();

      expect(slotsSpy).toHaveBeenCalled();
      expect(missingSpy).toHaveBeenCalled();
      // The grace delay must let the guess update the board before the
      // game-end logic reads it for missing-word detection.
      expect(slotsSpy.mock.invocationCallOrder[0]).toBeLessThan(
        missingSpy.mock.invocationCallOrder[0]
      );

      slotsSpy.mockRestore();
      missingSpy.mockRestore();
    });
  });

  describe('updateGameState', () => {
    beforeEach(() => {
      spectator = new GameSpectator();
      spectator.currentLevelSlots = [
        { letters: [], word: '', hitMax: false, index: 0, length: 4 }
      ];
    });

    it('should resolve a hidden (masked) word from the player chat history', () => {
      // Level 19+ masks the word with '?' so it must be recovered from chat.
      seedChat(spectator, 'testuser', 'test');

      (spectator as any).updateGameState('testuser', ['?', '?', '?', '?'], 0, false);

      expect(spectator.currentLevelCorrectWords).toContain('test');
    });

    it('should resolve a hidden word by length, ignoring other-length chat noise', () => {
      // The player typed several words; only the matching-length one is the
      // hidden guess.
      seedChat(spectator, 'testuser', 'longword');
      seedChat(spectator, 'testuser', 'test');
      seedChat(spectator, 'testuser', 'bigger');

      (spectator as any).updateGameState('testuser', ['?', '?', '?', '?'], 0, false);

      expect(spectator.currentLevelCorrectWords).toContain('test');
    });

    it('should return early only for a hidden word with no matching message', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

      // A masked word that cannot be resolved from chat is the only case that
      // should be dropped — there is genuinely no way to know the word.
      (spectator as any).updateGameState('testuser', ['?', '?', '?', '?'], 0, false);

      expect(warnSpy).toHaveBeenCalled();
      expect(spectator.currentLevelCorrectWords).toEqual([]);
      warnSpy.mockRestore();
    });

    it('should capture a non-hidden guess directly from letters without any chat message (issue #96)', () => {
      // The WoS event carries the full word for non-hidden levels, so a correct
      // guess must be captured even when no Twitch chat message is available
      // (e.g. the per-user/last-message state was overwritten by a near-
      // simultaneous guess before this delayed handler ran).
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

      (spectator as any).updateGameState('testuser', ['b', 'e', 'a', 'r'], 0, false);

      expect(warnSpy).not.toHaveBeenCalled();
      expect(spectator.currentLevelCorrectWords).toContain('bear');
      expect(spectator.currentLevelSlots[0].word).toBe('bear');
      expect(spectator.currentLevelSlots[0].user).toBe('testuser');
      warnSpy.mockRestore();
    });

    it('should capture both near-simultaneous non-hidden guesses even with stale chat state (issue #96)', () => {
      // Two players guess different words within milliseconds of each other.
      // Even if each player has since typed a newer, unrelated word, neither
      // guess should be dropped because the words are fully known from the WoS
      // `letters` and never consult chat.
      spectator.currentLevelSlots = [
        { letters: [], word: '', hitMax: false, index: 0, length: 4 },
        { letters: [], word: '', hitMax: false, index: 1, length: 4 },
      ];

      // Stale chat activity that no longer corresponds to the guesses.
      seedChat(spectator, 'alice', 'newer');
      seedChat(spectator, 'bob', 'longerword');

      (spectator as any).updateGameState('alice', ['b', 'e', 'a', 'r'], 0, false);
      (spectator as any).updateGameState('bob', ['b', 'o', 'a', 'r'], 1, false);

      expect(spectator.currentLevelSlots[0].word).toBe('bear');
      expect(spectator.currentLevelSlots[0].user).toBe('alice');
      expect(spectator.currentLevelSlots[1].word).toBe('boar');
      expect(spectator.currentLevelSlots[1].user).toBe('bob');
    });

    it('should resolve two simultaneous hidden guesses from different players without collision (issue #96)', () => {
      // Hidden level (19+): both words are masked, so each must be reconstructed
      // from the respective player's chat history. Per-user histories keep the
      // two players from interfering with each other.
      spectator.currentLevelSlots = [
        { letters: [], word: '', hitMax: false, index: 0, length: 5 },
        { letters: [], word: '', hitMax: false, index: 1, length: 5 },
      ];
      seedChat(spectator, 'alice', 'beard');
      seedChat(spectator, 'bob', 'cloud');

      (spectator as any).updateGameState('alice', ['?', '?', '?', '?', '?'], 0, false);
      (spectator as any).updateGameState('bob', ['?', '?', '?', '?', '?'], 1, false);

      expect(spectator.currentLevelSlots[0].word).toBe('beard');
      expect(spectator.currentLevelSlots[0].user).toBe('alice');
      expect(spectator.currentLevelSlots[1].word).toBe('cloud');
      expect(spectator.currentLevelSlots[1].user).toBe('bob');
    });

    it('should resolve two same-length hidden guesses from one player newest-first with consumption (issue #96)', () => {
      // A single player lands two same-length words in quick succession. Each
      // correct-guess event must consume a distinct chat message (newest first)
      // so the second event does not re-resolve to the first word.
      spectator.currentLevelSlots = [
        { letters: [], word: '', hitMax: false, index: 0, length: 5 },
        { letters: [], word: '', hitMax: false, index: 1, length: 5 },
      ];
      seedChat(spectator, 'alice', 'beard', 1);
      seedChat(spectator, 'alice', 'bread', 2);

      (spectator as any).updateGameState('alice', ['?', '?', '?', '?', '?'], 0, false);
      (spectator as any).updateGameState('alice', ['?', '?', '?', '?', '?'], 1, false);

      // The newest same-length message ('bread', timestamp 2) resolves first.
      expect(spectator.currentLevelSlots[0].word).toBe('bread');
      expect(spectator.currentLevelSlots[1].word).toBe('beard');
    });

    it('should prefer a valid dictionary word when disambiguating a hidden guess (issue #96)', () => {
      // The player typed an invalid word and a valid word of the same length;
      // the dictionary hint must steer resolution to the real word even though
      // the invalid one was typed first.
      vi.mocked(wosWords.isWosWord).mockImplementation((w: string) => w === 'beard');

      spectator.currentLevelLetters = ['b', 'e', 'a', 'r', 'd'];
      spectator.currentLevelSlots = [
        { letters: [], word: '', hitMax: false, index: 0, length: 5 },
      ];
      seedChat(spectator, 'alice', 'zzzzz', 1); // invalid, typed first
      seedChat(spectator, 'alice', 'beard', 2); // valid

      (spectator as any).updateGameState('alice', ['?', '?', '?', '?', '?'], 0, false);

      expect(spectator.currentLevelSlots[0].word).toBe('beard');
    });

    it('should reject a dictionary word whose letters do not fit the level (newest-first, letter-fit)', () => {
      // The player's chat history contains two real, same-length words but only
      // one can actually be spelled from the level's tiles. The other (even
      // though it is the newest message) must be rejected because its letters
      // don't fit within the level's valid letters.
      vi.mocked(wosWords.isWosWord).mockImplementation(
        (w: string) => w === 'beard' || w === 'ghost'
      );

      spectator.currentLevelLetters = ['b', 'e', 'a', 'r', 'd', '?'];
      spectator.currentLevelSlots = [
        { letters: [], word: '', hitMax: false, index: 0, length: 5 },
      ];
      seedChat(spectator, 'alice', 'beard', 1); // fits the level letters
      seedChat(spectator, 'alice', 'ghost', 2); // real word, but doesn't fit

      (spectator as any).updateGameState('alice', ['?', '?', '?', '?', '?'], 0, false);

      expect(spectator.currentLevelSlots[0].word).toBe('beard');
    });

    it('should treat a level ? as a wildcard when checking letter-fit', () => {
      // The guessed word uses a still-hidden letter (shown as ? on level 19+).
      // The single ? must satisfy the one missing 'y' so the word still fits.
      vi.mocked(wosWords.isWosWord).mockImplementation((w: string) => w === 'trilby');

      spectator.currentLevelLetters = ['t', 'l', 'r', 'i', 's', 'm', '?', 'b'];
      spectator.currentLevelSlots = [
        { letters: [], word: '', hitMax: false, index: 0, length: 6 },
      ];
      seedChat(spectator, 'alice', 'trilby', 1);

      (spectator as any).updateGameState('alice', ['?', '?', '?', '?', '?', '?'], 0, false);

      expect(spectator.currentLevelSlots[0].word).toBe('trilby');
    });

    it('should set big word when hitMax is true', () => {
      (spectator as any).updateGameState('testuser', ['t', 'e', 's', 't', 'i', 'n', 'g'], 0, true);

      expect(spectator.currentLevelBigWord).toBe('T E S T I N G');
      expect(document.getElementById('letters-label')!.innerText).toBe('Big Word:');
    });

    it('should reveal both hidden letters after big word found following dictionary detection of one (ADMIRE end-to-end)', () => {
      // Reproduces the bug reported after #83: starting board "R ? E D Q F ? I"
      // with hidden letters A and M, fake letters Q and F.
      // 1) An earlier guess containing M makes the dictionary path detect M and
      //    set the hidden display to just "M" while replacing one ? with M.
      // 2) The big word ADMIRE is then guessed (hitMax=true). Both A and M
      //    must show up in the hidden letter display.
      spectator.currentLevelLetters = ['r', '?', 'e', 'd', 'q', 'f', '?', 'i'];
      spectator.currentLevelSlots = [
        { letters: [], word: '', hitMax: false, index: 0, length: 5 },
        { letters: [], word: '', hitMax: false, index: 1, length: 6 },
      ];

      // Step 1: simulate a non-big-word guess that triggers dictionary
      // detection of "M" via the word DREAM (contains M which isn't visible).
      // The guess is non-hidden, so it resolves straight from `letters`.
      (spectator as any).updateGameState('player1', ['d', 'r', 'e', 'a', 'm'], 0, false);

      // The dictionary path should have detected at least one hidden letter
      // and the corresponding ? should be replaced.
      expect(spectator.currentLevelHiddenLetters.length).toBeGreaterThan(0);

      // Step 2: simulate the big word ADMIRE being guessed.
      (spectator as any).updateGameState('player2', ['a', 'd', 'm', 'i', 'r', 'e'], 1, true);

      const hiddenEl = document.getElementById('hidden-letter')!;
      const fakeEl = document.getElementById('fake-letter')!;

      // Both A and M must appear in the hidden letter display.
      const displayedHidden = hiddenEl.innerText.split(' ').filter(Boolean).sort();
      expect(displayedHidden).toContain('A');
      expect(displayedHidden).toContain('M');

      // Fake letters should still resolve to Q and F.
      const displayedFake = fakeEl.innerText.split(' ').filter(Boolean).sort();
      expect(displayedFake).toEqual(['F', 'Q']);
    });
  });
});
