import tmi, { type Client as tmiClient } from '@tmi.js/chat';
import io from 'socket.io-client';

import { findAllMissingWords, findMissingWordsFromBoard, loadWordsFromDb } from './wos-words';
import { saveBoard, fetchBoard, fetchChannelStats } from './db-service';
import { getMirrorGameId } from './mirror-url';


const twitchWorker = new Worker(
  new URL('../scripts/twitch-chat-worker.ts', import.meta.url),
  { type: 'module' }
);
const wosWorker = new Worker(
  new URL('../scripts/wos-worker.ts', import.meta.url),
  { type: 'module' }
);

type Slots = { letters: string[], word: string, user?: string, hitMax: boolean; index: number, length: number };

type EventTypes = 'level_end' | 'level_clear' | 'one_star' | 'three_stars' | 'new_all_time_pb' | 'new_daily_pb' | 'new_daily_clear';

export class GameSpectator {
  private msgProcessDelay = parseInt(import.meta.env.WOS_MSG_PROCESS_DELAY || '400');
  private lastTwitchMessage: {
    username: string;
    message: string;
    timestamp: number;
  } | null = null;
  wosGameLogId = 'wos-game-log';
  twitchChatLogId = 'twitch-chat-log';
  currentLevel: number = 0;
  twitchChatLog: Map<string, { message: string; timestamp: number; }>;
  soundEventTypes: Map<EventTypes, string> = new Map([
    ['level_end', '/assets/loser.wav'],
    ['level_clear', '/assets/clear.mp3'],
    ['one_star', '/assets/ooo_close_one.wav'],
    ['three_stars', '/assets/not_too_shabby.wav']
  ]);
  wosSocket: any;
  twitchClient: tmiClient | void = undefined;
  currentChannel: string = '';
  personalBest: number = 0;
  dailyBest: number = 0;
  dailyClears: number = 0;
  currentLevelBigWord: string = '';
  currentLevelCorrectWords: string[] = [];
  wosEventQueue: any[] = [];
  twitchEventQueue: any[] = [];
  currentLevelLetters: string[] = [];
  isProcessingWos: boolean = false;
  isProcessingTwitch: boolean = false;
  currentLevelHiddenLetters: string[] = [];
  currentLevelFakeLetters: string[] = [];
  currentLevelSlots: Slots[] = [];
  currentLevelEmptySlotsCount: { [key: number]: number; } = {};
  isSoundsEnabled: boolean = true;

  constructor() {
    this.twitchChatLog = new Map();
    this.wosSocket = null;
    loadWordsFromDb();
    this.startEventProcessors();
  }

  private async loadChannelRecords(channel: string) {
    const stats = await fetchChannelStats(channel);
    this.personalBest = stats.allTimePersonalBest;
    this.dailyBest = stats.dailyBest;
    this.dailyClears = stats.dailyClears;
    this.updateStatsDisplay();
  }

  private async refreshChannelStats() {
    if (!this.currentChannel) return;
    const stats = await fetchChannelStats(this.currentChannel);
    // Use Math.max to avoid overwriting optimistic local updates
    // when the bot hasn't written to the DB yet
    this.personalBest = Math.max(this.personalBest, stats.allTimePersonalBest);
    this.dailyBest = Math.max(this.dailyBest, stats.dailyBest);
    this.dailyClears = Math.max(this.dailyClears, stats.dailyClears);
    this.updateStatsDisplay();
  }

  private updateStatsDisplay() {
    const pbElement = document.getElementById('pb-value');
    if (pbElement) {
      pbElement.innerText = `${this.personalBest}`;
    }
    const dailyElement = document.getElementById('daily-pb-value');
    if (dailyElement) {
      dailyElement.innerText = `${this.dailyBest}`;
    }
    const clearElement = document.getElementById('daily-clear-value');
    if (clearElement) {
      clearElement.innerText = `${this.dailyClears}`;
    }
  }

  private async startEventProcessors() {
    // Set up WOS worker message handler
    wosWorker.onmessage = async (e) => {
      if (e.data.type === 'wos_event') {
        const { wosEventType, wosEventName, username, letters, hitMax, stars, level, falseLetters, hiddenLetters, slots, index } = e.data;

        const message = username ? `:${username} - ${letters.join('')} - Big Word: ${hitMax}` : '';
        console.log(`[WOS Event] <${wosEventName}>${message}`);

        if (wosEventType === 1 || wosEventType === 12) {
          this.handleGameInitialization(level, wosEventType, letters, slots);
          await this.refreshChannelStats();
        } else if (wosEventType === 3) {
          await this.handleCorrectGuess(username, letters, index, hitMax);
        } else if (wosEventType === 4) {
          await this.handleLevelResults(stars);
          // Delay to allow the chatbot to update the DB before reading
          await new Promise(resolve => setTimeout(resolve, 1500));
          await this.refreshChannelStats();
        } else if (wosEventType === 5) {
          await this.handleLevelEnd();
          await new Promise(resolve => setTimeout(resolve, 1500));
          await this.refreshChannelStats();
        } else if (wosEventType === 10) {
          this.handleLetterReveal(hiddenLetters, falseLetters);
        }
      }
    };

    // Set up Twitch worker message handler
    twitchWorker.onmessage = (e) => {
      if (e.data.type === 'twitch_message') {
        const { username, message, timestamp } = e.data;
        this.lastTwitchMessage = { username, message, timestamp };
        this.twitchChatLog.set(username, { message, timestamp });
        this.log(`[Twitch Chat] ${username}: ${message}`, this.twitchChatLogId);
      }
    };
  }

  private handleLetterReveal(hiddenLetters: any, falseLetters: any) {
    this.log(`Hidden/Fake Letters Revealed`, this.wosGameLogId);
    this.log(`Hidden Letters: ${hiddenLetters.join(' ')}`, this.wosGameLogId);
    this.log(`Fake Letters: ${falseLetters.join(' ')}`, this.wosGameLogId);
    if (falseLetters.length > 0) {
      document.getElementById('fake-letter')!.innerText = falseLetters.join(' ').toUpperCase();
    }
    if (hiddenLetters.length > 0) {
      document.getElementById('hidden-letter')!.innerText = hiddenLetters.join(' ').toUpperCase();
    }

    console.log('Current Level Big Word:', this.currentLevelBigWord);
    if (this.currentLevelBigWord === '') {
      // Then update currentLevelLetters with the hidden letters and remove the fake letters
      this.currentLevelLetters = this.currentLevelLetters.filter(letter => !falseLetters.includes(letter));
      this.currentLevelLetters.push(...hiddenLetters);
      this.currentLevelLetters = this.currentLevelLetters.filter(letter => letter !== '?');
      console.log('Updated currentLevelLetters:', this.currentLevelLetters);
      document.getElementById('letters')!.innerText = this.currentLevelLetters.join(' ').toUpperCase();
    }
  }

  private async handleLevelEnd() {
    this.log(`Game Ended on Level ${this.currentLevel}`, this.wosGameLogId);

    await this.logMissingWords();

    this.playSound('level_end');
  }

  private playSound(eventType: EventTypes) {
    if (!this.isSoundsEnabled) {
      return;
    }

    const soundFile = this.soundEventTypes.get(eventType);
    const audio = new Audio(soundFile || '/assets/nothing.mp3');
    audio.play().catch((error) => {
      console.error('Error playing audio:', error);
    });
  }

  private async handleLevelResults(stars: any) {
    this.log(`Level ${this.currentLevel} ended with ${stars} stars`, this.wosGameLogId);
    console.log(`[WOS Helper] Level ${this.currentLevel} ended`);
    this.log(`[WOS Helper] Total slots for level ${this.currentLevel}: ${this.currentLevelSlots.length}`, this.wosGameLogId);

    this.currentLevel += parseInt(stars);
    const levelTitleEl = document.getElementById('level-title')!;
    levelTitleEl.innerText = 'NEXT LEVEL';
    levelTitleEl.classList.add('long');
    document.getElementById('level-value')!.innerText = `${this.currentLevel}`;

    if (stars === 5 || this.currentLevelSlots.every(slot => slot.user)) {
      // Level completed successfully with all words found on the board (CLEAR)
      // Capture board data
      if (this.currentLevelBigWord && this.currentLevelSlots) {
        console.log('[WOS Helper] Saving board data to database...');
        console.log('[WOS Helper] Board ID:', this.currentLevelBigWord);
        console.log('[WOS Helper] Board Slots:', this.currentLevelSlots);
        let slots = this.currentLevelSlots;
        if (slots[slots.length - 1].word !== this.currentLevelBigWord) this.currentLevelBigWord = slots[slots.length - 1].word;
        await saveBoard(this.currentLevelBigWord, this.currentLevelSlots);
      }

      this.playSound('level_clear');
    } else {
      if (stars === 1) {
        this.playSound('one_star');
      }
      if (stars === 3) {
        this.playSound('three_stars');
      }
      await this.logMissingWords();
      this.logEmptySlots();
    }

    console.log(`[WOS Helper] Current Level Slots:`, this.currentLevelSlots);
  }
  logEmptySlots() {
    // slots missed/empty will have user property set to null
    let emptySlots = this.currentLevelSlots.filter(slot => !slot.user);
    if (emptySlots.length > 0) {
      // sort empty slots by the length of the letters array
      emptySlots.sort((a, b) => a.letters.length - b.letters.length);

      // count the number of empty slots by the length of the letters array
      this.currentLevelEmptySlotsCount = emptySlots.reduce((acc, slot) => {
        const key = slot.letters.length;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {} as { [key: number]: number; });

      this.log(`Total Empty Slots: ${emptySlots.length}`, this.wosGameLogId);

      // Iterate over emptySlotsCount and log the count of each length
      for (const [length, count] of Object.entries(this.currentLevelEmptySlotsCount)) {
        this.log(`Missed ${count}: ${length} letter words`, this.wosGameLogId);
      }
    }
  }

  private async handleCorrectGuess(username: string, letters: string[], index: number, hitMax: boolean) {
    await new Promise(resolve => setTimeout(resolve, this.msgProcessDelay));

    // Update UI with processed data
    this.updateGameState(username, letters, index, hitMax);
  }

  private handleGameInitialization(level: any, wosEventType: any, letters: any, slots: any) {
    if (wosEventType === 1) {
      this.clearBoard();
      console.log('[WOS Helper] Game Initialized with slots:', slots);
    }
    this.currentLevelSlots = slots;
    this.log(`Level ${level} ${wosEventType === 1 ? 'Started' : 'In Progress'}`, this.wosGameLogId);
    this.currentLevel = parseInt(level);
    const levelTitleEl = document.getElementById('level-title')!;
    levelTitleEl.innerText = 'LEVEL';
    levelTitleEl.classList.remove('long');
    document.getElementById('level-value')!.innerText = `${level}`;
    document.getElementById('letters-label')!.innerText = 'Letters:';
    if (letters.length > 0) {
      this.currentLevelLetters = letters;
      document.getElementById('letters')!.innerText = letters.join(' ').toUpperCase();
    }
  }

  private async logMissingWords() {
    // This should only ever be called after a level ends or the game fails at which time we either know the big word that has all valid letters we can use or the game revealed all hidden and fake letters so we can determine the current level correct letters to use for determining which words are missing at the end of the level/game
    let knownLetters = this.currentLevelBigWord !== '' ? this.currentLevelBigWord : this.currentLevelLetters.join('').replace('?', '');
    // Remove spaces from known letters as they are only for display purposes
    knownLetters = knownLetters.replace(/\s+/g, '');
    const minLength = this.currentLevelSlots.length > 0
      ? Math.min(...this.currentLevelSlots.map(slot => slot.letters.length))
      : 4;
    console.log('Known Letters:', knownLetters);
    console.log('Minimum Word Length:', minLength);
    console.log('Calculating missing words...');

    let missingWords: string[] = [];

    // Try to fetch board data if we have a big word
    if (this.currentLevelBigWord !== '') {
      console.log('Attempting to fetch board with ID:', this.currentLevelBigWord);
      const board = await fetchBoard(this.currentLevelBigWord);

      if (board && board.slots) {
        console.log('Board found in database, using board slots for missed words detection');
        // Use board-based detection
        missingWords = findMissingWordsFromBoard(this.currentLevelSlots, board.slots);
      } else {
        console.log('Board not found in database, falling back to dictionary-based detection');
        // Fall back to dictionary-based detection
        missingWords = findAllMissingWords(this.currentLevelCorrectWords, knownLetters, minLength);
      }
    } else {
      // No big word available, use dictionary-based detection
      console.log('No big word available, using dictionary-based detection');
      missingWords = findAllMissingWords(this.currentLevelCorrectWords, knownLetters, minLength);
    }

    if (missingWords.length > 0) {
      missingWords.forEach(word => {
        this.updateCorrectWordsDisplayed(word + "*");
      });
    }
  }

  private clearBoard() {
    console.log('[WOS Helper] Clearing the correct words and big word');
    this.currentLevelCorrectWords = [];
    this.currentLevelBigWord = '';
    this.lastTwitchMessage = null;
    this.currentLevelSlots = [];
    this.currentLevelLetters = [];
    this.currentLevelHiddenLetters = [];
    this.currentLevelFakeLetters = [];
    this.currentLevelEmptySlotsCount = {};
    this.twitchChatLog.clear();
    document.getElementById('correct-words-log')!.innerText = '';
    document.getElementById('letters')!.innerText = '';
    document.getElementById('letters-label')!.innerText = 'Letters:';
    document.getElementById('hidden-letter')!.innerText = '';
    document.getElementById('fake-letter')!.innerText = '';
  }

  private updateGameState(username: string, letters: string[], index: number, hitMax: boolean) {
    let word = letters.join('');

    // if (word.includes('?')) {
    // WOS is at level 20+ and hides the correct word
    // Get the latest message from the user in chat log
    // const latestMessage = this.twitchChatLog.get(username);
    const lowerUsername = username.toLowerCase();
    console.log(`[WOS Helper] Looking for ${lowerUsername}'s message in chat log`);
    console.log(`[WOS Helper] Last twitch message: ${JSON.stringify(this.lastTwitchMessage)}`);
    console.log(`[WOS Helper] Chat log entry for ${lowerUsername}: ${JSON.stringify(this.twitchChatLog.get(lowerUsername))}`);
    if (
      this.lastTwitchMessage &&
      this.lastTwitchMessage.username.toLowerCase() === lowerUsername &&
      this.lastTwitchMessage.message.length === letters.length
    ) {
      word = this.lastTwitchMessage.message;
    } else {
      // Fall back to chat log
      const latestMessage = this.twitchChatLog.get(lowerUsername);
      if (latestMessage && latestMessage.message.length === letters.length) {
        word = latestMessage.message;
      } else {
        console.warn(
          `[WOS Helper] Could not find matching message for ${lowerUsername}`,
          `[WOS Helper] Last message: ${JSON.stringify(this.lastTwitchMessage)}`,
          `[WOS Helper] Chat log entry: ${JSON.stringify(latestMessage)}`
        );
        return; // Skip updating UI if we can't find the word
      }
    }
    // }

    this.log(`[WOS Event] ${lowerUsername} correctly guessed: ${word}`, this.wosGameLogId);

    // Add to correct words list
    this.updateCorrectWordsDisplayed(word);
    this.updateCurrentLevelSlots(username, word.split(''), index, hitMax);

    // If hitMax is true, set the current level big word
    if (hitMax) {
      this.currentLevelBigWord = word.split('').join(' ').toUpperCase();
      document.getElementById('letters-label')!.innerText = 'Big Word:';
      document.getElementById('letters')!.innerText = this.currentLevelBigWord;
      this.calculateHiddenLetters(this.currentLevelBigWord);
      this.calculateFakeLetters(this.currentLevelBigWord);
    }


    // Try to determine hidden letters
    // Use letters found in this.currentLevelCorrectWords
    // Compare the letters from that with the letters in
    // this.currentLevelLetters and this should possible reveal the hidden letter(s)
    // Try to determine the full set of letters from correct words

    /*
    Level letters: T L R I S M ? B

    correctly guessed 'trilby'
    should be able to determine y is hidden
    need to consider multiple instances of the same letter too

    compare letters in 'trilby' with levelLetters and determine what's missing to identify a possible hidden letter



    -----

    when playing if we guess 'stim'
    can we use all possible letters from correctly guessed words
    */
    if (this.currentLevelCorrectWords.length > 0 && !hitMax) {
      // Count frequency of each letter in all correct words
      const correctLettersFrequency = new Map<string, number>();

      this.currentLevelCorrectWords.forEach(word => {
        // Skip words marked with * (these are missing words added by the system)
        if (!word.includes('*')) {
          // Count letter frequencies in this specific word
          const wordLetterFrequency = new Map<string, number>();
          const letters = word.toLowerCase().split('');

          letters.forEach(letter => {
            wordLetterFrequency.set(letter, (wordLetterFrequency.get(letter) || 0) + 1);
          });

          // Update correctLettersFrequency with the max frequency of each letter
          wordLetterFrequency.forEach((count, letter) => {
            const currentMax = correctLettersFrequency.get(letter) || 0;
            if (count > currentMax) {
              correctLettersFrequency.set(letter, count);
            }
          });
        }
      });

      // Count frequency of each letter in current level letters
      const levelLettersFrequency = new Map<string, number>();
      this.currentLevelLetters.forEach(letter => {
        if (letter !== '?') {
          levelLettersFrequency.set(letter, (levelLettersFrequency.get(letter) || 0) + 1);
        }
      });

      // Find potential hidden letters (letters that appear more times in correct words than in level letters)
      const potentialHiddenLetters: string[] = [];

      correctLettersFrequency.forEach((count, letter) => {
        const levelCount = levelLettersFrequency.get(letter) || 0;
        if (count > levelCount) {
          // Add the letter as many times as it's "missing"
          for (let i = 0; i < (count - levelCount); i++) {
            potentialHiddenLetters.push(letter);
          }
        }
      });

      // Log potential hidden letters if any were found
      if (potentialHiddenLetters.length > 0) {
        this.log(`Potential hidden letters: ${potentialHiddenLetters.join(' ')}`, this.wosGameLogId);

        // Note: previously this whole block was skipped if the hidden-letter
        // DOM already had text, which silently dropped any *additional* hidden
        // letters discovered in later guesses. We now always update state and
        // let currentLevelHiddenLetters track the cumulative set.
        // Skip letters we've already recorded so re-running detection on later
        // guesses is idempotent.
        const knownHidden = this.currentLevelHiddenLetters.map(l => l.toLowerCase());
        const newlyFound: string[] = [];
        for (const letter of potentialHiddenLetters) {
          const lower = letter.toLowerCase();
          // Use letter counts in case of duplicates being discovered.
          const knownCount = knownHidden.filter(l => l === lower).length
            + newlyFound.filter(l => l === lower).length;
          const totalCount = potentialHiddenLetters.filter(l => l.toLowerCase() === lower).length;
          if (knownCount < totalCount) {
            newlyFound.push(lower);
          }
        }

        if (newlyFound.length > 0) {
          // Always REPLACE ? slots with the newly-discovered letters so that
          // currentLevelLetters stays a consistent source of truth (visible +
          // discovered-hidden). Earlier code instead removed ? slots in some
          // branches without inserting the letter, which made it impossible
          // to reconstruct what was actually on the board.
          const questionMarksCount = this.currentLevelLetters.filter(letter => letter === '?').length;
          const lettersToReplace = Math.min(newlyFound.length, questionMarksCount);
          for (let i = 0; i < lettersToReplace; i++) {
            const idx = this.currentLevelLetters.indexOf('?');
            if (idx !== -1) {
              this.currentLevelLetters[idx] = newlyFound[i];
            }
          }
          // Record the cumulative set of discovered hidden letters.
          this.currentLevelHiddenLetters.push(...newlyFound.slice(0, lettersToReplace));

          document.getElementById('letters')!.innerText = this.currentLevelLetters.join(' ').toUpperCase();
        }

        // Always reflect the cumulative set of hidden letters in the DOM so
        // that a second/third discovery is visible to viewers.
        document.getElementById('hidden-letter')!.innerText =
          this.currentLevelHiddenLetters.map(l => l.toUpperCase()).join(' ');
      }
    }
  }

  private updateCurrentLevelSlots(username: string, letters: string[], index: number, hitMax: boolean) {
    // Update the current level slots with the correct guess word
    if (index >= 0 && index < this.currentLevelSlots.length) {
      this.currentLevelSlots[index] = {
        letters: letters,
        word: letters.join(''),
        user: username,
        hitMax: hitMax,
        index,
        length: letters.length
      };
      console.log(`[WOS Helper] Updated slot at index ${index}:`, this.currentLevelSlots[index]);
    } else {
      console.warn(`Invalid index ${index} for current level slots`);
    }
  }

  private updateCorrectWordsDisplayed(word: string) {
    this.currentLevelCorrectWords.push(word);

    const sortedWords = [...this.currentLevelCorrectWords].sort((a, b) => {
      const aWord = a.replace('*', '');
      const bWord = b.replace('*', '');
      const lengthDiff = aWord.length - bWord.length;

      if (lengthDiff !== 0) {
        return lengthDiff;
      }

      const alphabeticalDiff = aWord.toLowerCase().localeCompare(bWord.toLowerCase());
      if (alphabeticalDiff !== 0) {
        return alphabeticalDiff;
      }

      if (a.endsWith('*') !== b.endsWith('*')) {
        return a.endsWith('*') ? 1 : -1;
      }

      return 0;
    });

    this.currentLevelCorrectWords = sortedWords;

    const groupedWords = sortedWords.reduce((map, currentWord) => {
      const key = currentWord.replace('*', '').length;
      if (!map.has(key)) {
        map.set(key, [] as string[]);
      }
      map.get(key)!.push(currentWord);
      return map;
    }, new Map<number, string[]>());

    const logEl = document.getElementById('correct-words-log');
    if (!logEl) {
      return;
    }

    (logEl as HTMLElement).innerHTML = '';

    const fragment = document.createDocumentFragment();

    Array.from(groupedWords.entries())
      .sort((a, b) => a[0] - b[0])
      .forEach(([length, words]) => {
        const groupEl = document.createElement('div');
        groupEl.className = 'word-group';

        const titleEl = document.createElement('div');
        titleEl.className = 'word-group__title';
        titleEl.textContent = `${length}:`;
        groupEl.appendChild(titleEl);

        const wordsContainer = document.createElement('div');
        wordsContainer.className = 'word-group__words';

        words.forEach(current => {
          const displayWord = current.replace('*', '').toUpperCase();
          const wordEl = document.createElement('span');
          wordEl.className = `correct-word${current.endsWith('*') ? ' missing-word' : ''}`;
          wordEl.textContent = `${displayWord}${current.endsWith('*') ? '*' : ''}`;
          wordsContainer.appendChild(wordEl);
        });

        groupEl.appendChild(wordsContainer);
        fragment.appendChild(groupEl);
      });

    logEl.appendChild(fragment);

    const logContainer = logEl as HTMLElement;
    const hasOverflow = logContainer.scrollHeight > logContainer.clientHeight;

    if (hasOverflow) {
      const overflowDistance = logContainer.scrollHeight - logContainer.clientHeight;
      logContainer.style.setProperty('--scroll-amount', `${-overflowDistance}px`);

      // Restart the animation so new content begins from the top each update
      logContainer.classList.remove('auto-scroll');
      void logContainer.offsetHeight;
      logContainer.classList.add('auto-scroll');
    } else {
      logContainer.style.setProperty('--scroll-amount', '0px');
      logContainer.classList.remove('auto-scroll');
    }
  }

  calculateHiddenLetters(bigWord: string) {
    const bigWordLetters = bigWord.split(' ').map(letter => letter.toLowerCase());
    console.log(`Big Word Letters: ${bigWordLetters.join(' ')}`, this.wosGameLogId);
    console.log(`Current Level Letters: ${this.currentLevelLetters.join(' ')}`, this.wosGameLogId);
    console.log(`Previously Discovered Hidden Letters: ${this.currentLevelHiddenLetters.join(' ')}`, this.wosGameLogId);

    // Hidden letters = letters in the big word that aren't accounted for in
    // currentLevelLetters. Thanks to the dictionary detection path always
    // *replacing* ? slots with the discovered letter (rather than removing
    // them), currentLevelLetters is a faithful representation of what's on
    // the board: visible letters + already-discovered hidden letters + any
    // remaining ? placeholders for undiscovered hidden letters.
    const bigWordCounts = new Map<string, number>();
    bigWordLetters.forEach(letter => {
      bigWordCounts.set(letter, (bigWordCounts.get(letter) || 0) + 1);
    });

    // Skip ? placeholders so they surface as a deficit below. Letters that
    // were merged into currentLevelLetters by the dictionary detection
    // path (replacing a ?) are naturally counted here, so re-running this
    // function after a successful discovery computes a zero deficit.
    const levelLetterCounts = new Map<string, number>();
    this.currentLevelLetters.forEach(letter => {
      if (letter === '?') return;
      const lower = letter.toLowerCase();
      levelLetterCounts.set(lower, (levelLetterCounts.get(lower) || 0) + 1);
    });

    // Deficit: letters in the big word not accounted for by visible board
    // letters (? slots and any hidden letters not yet merged into
    // currentLevelLetters surface here).
    const deficit: string[] = [];
    bigWordCounts.forEach((bigCount, letter) => {
      const levelCount = levelLetterCounts.get(letter) || 0;
      const missing = bigCount - levelCount;
      for (let i = 0; i < missing; i++) {
        deficit.push(letter);
      }
    });

    // Idempotency: this method may be invoked multiple times in a single
    // level (every guess where hitMax === true triggers it). When a level
    // has multiple anagram big words — e.g. BROOMED / BEDROOM / BOREDOM —
    // each one fires hitMax and we re-enter here. Without this guard the
    // same hidden letters get appended on every call (see regression test).
    const deficitCounts = new Map<string, number>();
    deficit.forEach(l => deficitCounts.set(l, (deficitCounts.get(l) || 0) + 1));

    const knownHiddenCounts = new Map<string, number>();
    this.currentLevelHiddenLetters.forEach(letter => {
      const lower = letter.toLowerCase();
      knownHiddenCounts.set(lower, (knownHiddenCounts.get(lower) || 0) + 1);
    });

    const trulyNew: string[] = [];
    deficitCounts.forEach((needed, letter) => {
      const have = knownHiddenCounts.get(letter) || 0;
      const toAdd = Math.max(0, needed - have);
      for (let i = 0; i < toAdd; i++) trulyNew.push(letter);
    });

    if (trulyNew.length > 0) {
      // Replace ? slots in currentLevelLetters with the newly-discovered
      // letters so subsequent reads see a consistent board state. This
      // matches the convention used by the dictionary detection branch
      // and is what makes future invocations idempotent.
      const questionMarksCount = this.currentLevelLetters.filter(l => l === '?').length;
      const lettersToReplace = Math.min(trulyNew.length, questionMarksCount);
      for (let i = 0; i < lettersToReplace; i++) {
        const idx = this.currentLevelLetters.indexOf('?');
        if (idx !== -1) {
          this.currentLevelLetters[idx] = trulyNew[i];
        }
      }
      // Record the cumulative set of discovered hidden letters. Unlike
      // the dictionary branch we record all `trulyNew` (not just
      // `lettersToReplace`-many) — the big word is authoritative, so
      // every deficit letter is a real hidden letter even if there
      // happens to be no ? slot to merge it into.
      this.currentLevelHiddenLetters.push(...trulyNew);
    }

    // Display the full cumulative set: previously known + newly found.
    const allHidden = this.currentLevelHiddenLetters.map(l => l.toLowerCase());
    this.log(`Hidden Letters: ${allHidden.join(' ')}`, this.wosGameLogId);
    if (allHidden.length > 0 && allHidden.length !== this.currentLevelLetters.length) {
      document.getElementById('hidden-letter')!.innerText = allHidden.join(' ').toUpperCase();
    }
  }

  calculateFakeLetters(bigWord: string) {
    const bigWordLetters = bigWord.split(' ').map(letter => letter.toLowerCase());
    const fakeLetters = this.currentLevelLetters.filter(letter => !bigWordLetters.includes(letter) && letter !== '?');
    this.log(`Fake Letters: ${fakeLetters.join(' ')}`, this.wosGameLogId);
    if (fakeLetters.length > 0 && fakeLetters.length !== this.currentLevelLetters.length) {
      document.getElementById('fake-letter')!.innerText = fakeLetters.join(' ').toUpperCase();
    }
  }

  getMirrorCode(mirrorUrl: string) {
    // Only accept official WoS mirror references (https://wos.gg/r/<gameId>).
    // Returns null for anything else so we never connect with a bogus uid.
    return getMirrorGameId(mirrorUrl);
  }

  connectToWosGame(mirrorUrl: string) {
    const gameCode = this.getMirrorCode(mirrorUrl);
    if (!gameCode) {
      this.log('Invalid mirror URL', this.wosGameLogId);
      return;
    }

    if (this.wosSocket) {
      this.wosSocket.disconnect();
    }

    this.wosSocket = io('wss://wos2.gartic.es', {
      autoConnect: true,
      transports: ['websocket'],
      query: {
        uid: gameCode
      }
    });

    this.wosSocket.on((event: string, ...args: any[]) => {
      this.log(`Event received: ${event}`, this.wosGameLogId);
      this.log(`Data: ${JSON.stringify(args, null, 2)}`, this.wosGameLogId);
    });

    this.wosSocket.on('3', (eventType: any, data: any) => {
      // console.log('[WOS Event] Event received: ', eventType, data);
      wosWorker.postMessage({ eventType, data });
    });

    this.wosSocket.on('connect', () => {
      this.log('Connected to WOS game: ' + gameCode, this.wosGameLogId);
    });

    this.wosSocket.on('reconnect_attempt', () => {
      this.wosSocket.io.opts.query.uid = this.getMirrorCode(mirrorUrl);
      this.log('Attempting to reconnect to WOS game: ' + this.getMirrorCode(mirrorUrl), this.wosGameLogId);
    });

    this.wosSocket.on('connect_error', (error: string) => {
      this.log('WOS Connection error: ' + error, this.wosGameLogId);
    });

    this.wosSocket.on('disconnect', () => {
      this.log('Disconnected from WOS game server', this.wosGameLogId);
    });

    this.wosSocket.on('error', (error: any) => {
      console.error('WOS Socket error:', error);
      this.log('WOS Socket error: ', this.wosGameLogId);
    });
  }

  connectToTwitch(channel: string) {
    if (!channel.startsWith('#')) {
      channel = '#' + channel;
    }

    this.currentChannel = channel.replace('#', '');
    this.loadChannelRecords(this.currentChannel);

    if (this.twitchClient) {
      this.disconnectTwitch();
    }

    this.twitchClient = new tmi.Client({
      channels: [channel]
    });

    this.twitchClient.on('message', (e) => {
      twitchWorker.postMessage({
        username: e.user.login.toLowerCase(),
        message: e.message.text.toLowerCase(),
        timestamp: Date.now()
      });
    });

    this.twitchClient.on('connect', () => {
      this.log(`Connected to Twitch chat for channel: ${channel}`, this.twitchChatLogId);
    });

    this.twitchClient.on('close', (reason: any) => {
      this.log(`Disconnected from Twitch chat: ${reason}`, this.twitchChatLogId);
    });

    try {
      this.twitchClient.connect();
    } catch (error) {
      this.log(`Error connecting to Twitch chat: ${error}`, this.twitchChatLogId);
    }
  }

  disconnect() {
    if (this.wosSocket) {
      this.wosSocket.disconnect();
      this.wosSocket = null;
    }
  }

  disconnectTwitch() {
    if (this.twitchClient) {
      this.twitchClient.close();
      this.twitchClient = undefined;
    }
  }

  log(message: string, logId: string) {
    const logDiv = document.getElementById(logId || 'wos-game-log');
    if (typeof message === 'object') {
      message = JSON.stringify(message, null, 2);
    }
    if (logDiv) {
      logDiv!.innerText += `${message}\n`;
      logDiv!.scrollTop = logDiv!.scrollHeight;
    }
    console.log(message);
  }

  // private async processWosEvent(event: { type: number; data: any; }) {
  //   const eventType = event.type;
  //   const data = event.data;
  //   this.log(`Processing WOS event: ${event.type}`, 'wos-game-log');
  //   let correctWord = '';
  //   this.log(`Game Event Type: ${eventType}`, this.wosGameLogId);
  //   // this.log(`Data: ${JSON.stringify(data, null, 2)}`, wosGameLogId)

  //   // correct guess event
  //   if (eventType === 3) {
  //     if (data.letters.includes('?')) {
  //       // correct guesses are hidden so get the latest message for that user from chat log
  //       const username = data.user.name.toLowerCase();
  //       const latestMessage = this.twitchChatLog.get(username);
  //       if (
  //         latestMessage &&
  //         latestMessage.message.length === data.letters.length
  //       ) {
  //         this.log(
  //           `${data.user.name} correctly guessed: ${latestMessage.message}`,
  //           this.wosGameLogId
  //         );
  //         this.currentLevelCorrectWords.push(latestMessage.message);
  //         correctWord = latestMessage.message;
  //       } else {
  //         console.warn(
  //           `Could not find a matching message for ${data.user.name} in the chat log
  //               Twitch username: ${username}
  //               Twitch message: ${latestMessage?.message}
  //               WOS Hidden Word: ${data.letters.join('')}
  //               WOS word length: ${data.letters.length}`
  //         );
  //       }
  //     } else {
  //       this.log(
  //         `${data.user.name} correctly guessed: ${data.letters.join('')}`,
  //         this.wosGameLogId
  //       );
  //       this.currentLevelCorrectWords.push(data.letters.join(''));
  //       correctWord = data.letters.join('');
  //     }

  //     document.getElementById('correct-words-log')!.innerText =
  //       this.currentLevelCorrectWords.join(', ');
  //     if (data.hitMax === true) {
  //       this.currentLevelBigWord = correctWord
  //         .split('')
  //         .join(' ')
  //         .toUpperCase();
  //       document.getElementById('big-word')!.innerText =
  //         this.currentLevelBigWord;
  //     }
  //   }

  //   if (eventType === 4) {
  //     this.log(`Level ended with ${data.stars} stars`, this.wosGameLogId);
  //     this.currentLevelCorrectWords = [];
  //     this.currentLevelBigWord = '';
  //     document.getElementById('correct-words-log')!.innerText = '';
  //     document.getElementById('big-word')!.innerText = '';
  //   }

  //   if (eventType === 1) {
  //     this.log(`Level ${data.level} started`, this.wosGameLogId);
  //     this.currentLevel = parseInt(data.level);
  //     document.getElementById('level-title')!.innerText =
  //       `Level: ${data.level}`;
  //   }

  //   // round end, clear chat log
  //   if (eventType === 8) {
  //     this.twitchChatLog.clear();
  //   }
  // }
}
