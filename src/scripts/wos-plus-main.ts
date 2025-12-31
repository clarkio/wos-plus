import tmi, { type Client as tmiClient } from '@tmi.js/chat';
import io from 'socket.io-client';

import { findAllMissingWords, loadWordsFromDb } from './wos-words';
import { saveBoard } from './db-service';


const twitchWorker = new Worker(
  new URL('../scripts/twitch-chat-worker.ts', import.meta.url),
  { type: 'module' }
);
const wosWorker = new Worker(
  new URL('../scripts/wos-worker.ts', import.meta.url),
  { type: 'module' }
);

type Slots = { letters: string[], word: string, user?: string, hitMax: boolean; index: number, length: number };

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
  wosSocket: any;
  twitchClient: tmiClient | void = undefined;
  currentChannel: string = '';
  personalBest: number = 0;
  pbStorageKey: string = '';
  dailyBest: number = 0;
  dailyPbStorageKey: string = '';
  dailyClears: number = 0;
  dailyClearsStorageKey: string = '';
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
  clearSoundEnabled: boolean = true;

  constructor() {
    this.twitchChatLog = new Map();
    this.wosSocket = null;
    loadWordsFromDb();
    this.startEventProcessors();
  }

  private getTodayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  private loadChannelRecords(channel: string) {
    this.pbStorageKey = `pb_${channel.toLowerCase()}`;
    const stored = localStorage.getItem(this.pbStorageKey);
    this.personalBest = stored ? parseInt(stored) : 0;

    this.dailyPbStorageKey = `pb_${channel.toLowerCase()}_${this.getTodayKey()}`;
    const storedDaily = localStorage.getItem(this.dailyPbStorageKey);
    console.log('Stored Daily Best Value:', storedDaily);
    this.dailyBest = storedDaily ? parseInt(storedDaily) : 0;

    this.dailyClearsStorageKey = `clears_${channel.toLowerCase()}_${this.getTodayKey()}`;
    const storedClears = localStorage.getItem(this.dailyClearsStorageKey);
    this.dailyClears = storedClears ? parseInt(storedClears) : 0;

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

  private updateChannelDailyRecord(level: number) {
    if (level > this.dailyBest) {
      this.dailyBest = level;
      if (this.dailyPbStorageKey) {
        localStorage.setItem(this.dailyPbStorageKey, String(this.dailyBest));
      }
      const dailyElement = document.getElementById('daily-pb-value');
      if (dailyElement) {
        dailyElement.innerText = `${this.dailyBest}`;
      }
    }
  }

  private updateChannelAllTimeRecord(record: number) {
    if (record > this.personalBest) {
      this.personalBest = record;
      if (this.pbStorageKey) {
        localStorage.setItem(this.pbStorageKey, String(this.personalBest));
      }
      const pbElement = document.getElementById('pb-value');
      if (pbElement) {
        pbElement.innerText = `${this.personalBest}`;
      }
    }
  }

  private recordBoardClear() {
    this.dailyClears += 1;
    if (this.dailyClearsStorageKey) {
      localStorage.setItem(this.dailyClearsStorageKey, String(this.dailyClears));
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
        const { wosEventType, wosEventName, username, letters, hitMax, stars, level, falseLetters, hiddenLetters, slots, index, record } = e.data;

        if (record && typeof record === 'number') {
          this.updateChannelAllTimeRecord(record);
        }

        const message = username ? `:${username} - ${letters.join('')} - Big Word: ${hitMax}` : '';
        console.log(`[WOS Event] <${wosEventName}>${message}`);

        if (wosEventType === 1 || wosEventType === 12) {
          this.handleGameInitialization(level, wosEventType, letters, slots);
        } else if (wosEventType === 3) {
          await this.handleCorrectGuess(username, letters, index, hitMax);
        } else if (wosEventType === 4) {
          this.handleLevelResults(stars);
        } else if (wosEventType === 5) {
          this.handleLevelEnd();
        } else if (wosEventType === 10) {
          this.handleLetterReveal(hiddenLetters, falseLetters);
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

  private handleLevelEnd() {
    this.log(`Game Ended on Level ${this.currentLevel}`, this.wosGameLogId);

    this.logMissingWords();
  }

  private async handleLevelResults(stars: any) {
    this.log(`Level ${this.currentLevel} ended with ${stars} stars`, this.wosGameLogId);
    console.log(`[WOS Helper] Level ${this.currentLevel} ended`);
    this.log(`[WOS Helper] Total slots for level ${this.currentLevel}: ${this.currentLevelSlots.length}`, this.wosGameLogId);

    this.currentLevel += parseInt(stars);
    this.updateChannelDailyRecord(this.currentLevel);
    const levelTitleEl = document.getElementById('level-title')!;
    levelTitleEl.innerText = 'NEXT LEVEL';
    levelTitleEl.classList.add('long');
    document.getElementById('level-value')!.innerText = `${this.currentLevel}`;

    if (stars === 5 || this.currentLevelSlots.every(slot => slot.user)) {
      // Level completed successfully with all words found on the board (CLEAR)
      this.recordBoardClear();

      // Capture board data
      if (this.currentLevelBigWord && this.currentLevelSlots) {
        console.log('[WOS Helper] Saving board data to database...');
        console.log('[WOS Helper] Board ID:', this.currentLevelBigWord);
        console.log('[WOS Helper] Board Slots:', this.currentLevelSlots);
        let slots = this.currentLevelSlots;
        if (slots[slots.length - 1].word !== this.currentLevelBigWord) this.currentLevelBigWord = slots[slots.length - 1].word;
        await saveBoard(this.currentLevelBigWord, this.currentLevelSlots);
      }

      if (this.clearSoundEnabled) {
        const audio = new Audio('/assets/clear.mp3');
        audio.play().catch((error) => {
          console.error('Error playing audio:', error);
        });
      }
    } else {
      this.logMissingWords();
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
    this.updateChannelAllTimeRecord(this.currentLevel);
    this.updateChannelDailyRecord(this.currentLevel);
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

  private logMissingWords() {
    // This should only ever be called after a level ends or the game fails at which time we either know the big word that has all valid letters we can use or the game revealed all hidden and fake letters so we can determine the current level correct letters to use for determining which words are missing at the end of the level/game
    const knownLetters = this.currentLevelBigWord !== '' ? this.currentLevelBigWord : this.currentLevelLetters.join('').replace('?', '');
    const minLength = this.currentLevelSlots.length > 0
      ? Math.min(...this.currentLevelSlots.map(slot => slot.letters.length))
      : 4;
    console.log('Known Letters:', knownLetters);
    console.log('Minimum Word Length:', minLength);
    console.log('Calculating missing words...');
    const missingWords = findAllMissingWords(this.currentLevelCorrectWords, knownLetters, minLength);

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

        // Update the hidden letters display
        const currentHiddenLetters = document.getElementById('hidden-letter')!.innerText;
        if (!currentHiddenLetters) {
          document.getElementById('hidden-letter')!.innerText = potentialHiddenLetters.join(' ').toUpperCase();

          // Check if currentLevelLetters contains more than one '?'
          if (this.currentLevelLetters.filter(letter => letter === '?').length === 1) {
            this.currentLevelLetters = this.currentLevelLetters.filter(letter => letter !== '?');
            this.currentLevelHiddenLetters.push(...potentialHiddenLetters);
            document.getElementById('letters')!.innerText = this.currentLevelLetters.join(' ').toUpperCase();
          } else {
            // If there are multiple '?' check how many potential hidden letters we have and if it matches the number of '?'
            const questionMarksCount = this.currentLevelLetters.filter(letter => letter === '?').length;
            if (potentialHiddenLetters.length === questionMarksCount) {
              this.currentLevelLetters = this.currentLevelLetters.filter(letter => letter !== '?');
              this.currentLevelHiddenLetters.push(...potentialHiddenLetters);
              document.getElementById('letters')!.innerText = this.currentLevelLetters.join(' ').toUpperCase();
            } else {
              // If not, only replace the same number of '?' with the same number of potential hidden letters
              const lettersToReplace = Math.min(potentialHiddenLetters.length, questionMarksCount);
              for (let i = 0; i < lettersToReplace; i++) {
                const index = this.currentLevelLetters.indexOf('?');
                if (index !== -1) {
                  this.currentLevelLetters[index] = potentialHiddenLetters[i];
                }
              }
              this.currentLevelHiddenLetters.push(...potentialHiddenLetters.slice(0, lettersToReplace));
            }
          }
        }
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
    // compare bigWordLetters with currentLevelLetters
    // if a letter is in the bigWordLetters but not in currentLevelLetters, it is hidden
    // if a letter is in the bigWordLetters more than once and is in currentLevelLetters, it is hidden as well
    const hiddenLettersSet = new Set<string>();
    bigWordLetters.forEach(letter => {
      const bigWordLetterCount = bigWordLetters.filter(l => l === letter).length;
      const currentLevelLetterCount = this.currentLevelLetters.filter(l => l === letter).length;
      if (currentLevelLetterCount < bigWordLetterCount) {
        hiddenLettersSet.add(letter);
      }
    });
    const hiddenLetters = Array.from(hiddenLettersSet);
    this.log(`Hidden Letters: ${hiddenLetters.join(' ')}`, this.wosGameLogId);
    if (hiddenLetters.length > 0 && hiddenLetters.length !== this.currentLevelLetters.length) {
      document.getElementById('hidden-letter')!.innerText = hiddenLetters.join(' ').toUpperCase();
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
    try {
      const url = new URL(mirrorUrl);
      const pathParts = url.pathname.split('/');
      const codeIndex = pathParts.indexOf('r') + 1;
      if (codeIndex > 0 && codeIndex < pathParts.length) {
        return pathParts[codeIndex];
      }
      return null;
    } catch (error) {
      console.error('Error parsing mirror URL:', error);
      return null;
    }
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
