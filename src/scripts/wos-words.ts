// import localDictionary from './wos_dictionary.json';
let wosDictionary: string[]; // = localDictionary as string[];
// Lower-cased lookup set kept in sync with wosDictionary so membership checks
// (used to disambiguate Twitch chat messages, see isWosWord) are O(1).
let wosDictionarySet: Set<string> = new Set();

/**
 * Returns true when `word` is a known Words on Stream dictionary word.
 * Used to prefer real words when reconstructing a hidden guess from a player's
 * Twitch chat messages. Returns false (rather than throwing) when the
 * dictionary hasn't loaded yet, so callers can safely treat it as a soft hint.
 */
export function isWosWord(word: string): boolean {
  if (!word) return false;
  return wosDictionarySet.has(word.toLowerCase());
}

/**
 * Returns true when `word` can be spelled using `availableLetters`, respecting
 * letter frequency (each tile can only be used once). A '?' in availableLetters
 * is treated as a wildcard that matches any single letter, which is how a
 * level's still-hidden letters (level 19+) appear before they're revealed.
 *
 * Used when reconstructing a masked correct-guess from a player's Twitch chat:
 * a candidate message must not only be a real word but also actually be
 * spellable from the level's tiles, otherwise it can't be the word WoS accepted.
 */
export function canFormWord(word: string, availableLetters: string[]): boolean {
  if (!word) return false;

  const available: { [key: string]: number } = {};
  let wildcards = 0;
  for (const rawLetter of availableLetters) {
    const letter = rawLetter.toLowerCase();
    if (letter === '?') {
      wildcards++;
    } else {
      available[letter] = (available[letter] || 0) + 1;
    }
  }

  for (const char of word.toLowerCase()) {
    if (available[char]) {
      available[char]--;
    } else if (wildcards > 0) {
      wildcards--;
    } else {
      return false;
    }
  }

  return true;
}

export interface Slot {
  letters: string[];
  user?: string | null;
  hitMax: boolean;
  originalIndex?: number;
  word: string;
  index?: number;
  length?: number;
}

export async function updateWordsDb(word: string) {
  try {
    if (wosDictionary && wosDictionary.includes(word)) {
      console.log(`Word "${word}" already exists in the WOS dictionary.`);
      return;
    }

    const url = 'https://clarkio.com/wos-dictionary';
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ word }),
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.status} ${response.statusText}`);
    }

    console.log(`Successfully updated dictionary with word: ${word}`);
    wosDictionary.push(word);
    wosDictionarySet.add(word.toLowerCase());
    console.log(`WOS Dictionary now contains ${wosDictionary.length} words.`);
    return response.json();
  } catch (error) {
    console.error('Error updating WOS dictionary:', error);
    throw error;
  }
}

export async function loadWordsFromDb() {
  try {
    const url = '/api/words';

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error('Network response was not ok');
    }

    const wordsJson = await response.json();
    wosDictionary = wordsJson.map((word: string) => word.trim());
    wosDictionarySet = new Set(wosDictionary.map(word => word.toLowerCase()));
    console.log('WOS Dictionary loaded:', wosDictionary.length, 'words');
  } catch (error) {
    console.error('Error loading WOS dictionary:', error);
  }
}

export function findAllMissingWords(knownWords: string[], knownLetters: string, minLength: number): string[] {
  // Find all possible words that can be formed from knownLetters
  // and filter out words that are already known
  const possibleWords = findWosWordsByLetters(knownLetters, minLength);
  console.log('Possible words:', possibleWords);
  const tempMissingWords = findMissingWordsFromList(knownWords, possibleWords);
  const missingWords = tempMissingWords.filter(word => word.length >= minLength);
  console.log('Missing words:', missingWords);
  return missingWords;
}

/**
 * Finds missing words by comparing current level slots with board slots
 * @param currentSlots Array of current level slots (some may be empty)
 * @param boardSlots Array of complete board slots from database
 * @returns Array of words that were missed (not guessed in current level)
 */
export function findMissingWordsFromBoard(currentSlots: Slot[], boardSlots: Slot[]): string[] {
  const missingWords: string[] = [];
  
  // Create a map of current guessed words for quick lookup
  const guessedWords = new Set(
    currentSlots
      .filter(slot => slot.user && slot.word)
      .map(slot => slot.word.toLowerCase())
  );
  
  // For each slot in the board, check if it was guessed in current level
  boardSlots.forEach((boardSlot, index) => {
    const word = boardSlot.word;
    if (!word || word.length === 0) {
      return; // Skip empty slots in board data
    }
    
    // Check if this word was guessed
    if (!guessedWords.has(word.toLowerCase())) {
      // Check if current slot at this position is empty (not guessed)
      const currentSlot = currentSlots[index];
      if (currentSlot && !currentSlot.user) {
        missingWords.push(word);
      }
    }
  });
  
  console.log('Missing words from board:', missingWords);
  return missingWords;
}

/**
 * Finds words in dictionaryWords that are not present in knownWords
 * @param knownWords Array of words already known
 * @param dictionaryWords Array of words to check against
 * @returns Array of words from dictionaryWords that are not in knownWords
 */
function findMissingWordsFromList(knownWords: string[], dictionaryWords: string[]): string[] {
  // Create a Set of knownWords for efficient lookup
  const knownWordsSet = new Set(knownWords.map(word => word.toLowerCase()));

  // Filter dictionaryWords to find words not in knownWordsSet
  return dictionaryWords.filter(word => !knownWordsSet.has(word.toLowerCase()));
}

/**
 * Finds all possible words from wosWords that can be formed using the given letters
 * @param letters The letters available to form words
 * @param length Optional parameter to filter words by exact length
 * @returns Array of words sorted by length (longest first)
 */
function findWosWordsByLetters(letters: string, length?: number): string[] {
  // Create a map to track letter frequencies in the input
  const letterFrequency: { [key: string]: number } = {};
  letters = letters.toLowerCase();

  for (const char of letters) {
    letterFrequency[char] = (letterFrequency[char] || 0) + 1;
  }

  // Filter words that can be formed from the given letters
  let possibleWords = (wosDictionary as string[]).filter((word) => {
    // Create a copy of the letter frequency map for each word check
    const availableLetters = { ...letterFrequency };

    for (const char of word.toLowerCase()) {
      // If the character isn't available or has been used up, word can't be formed
      if (!availableLetters[char]) {
        return false;
      }
      availableLetters[char]--;
    }

    return true;
  });

  // Filter by length if specified
  if (length !== undefined) {
    possibleWords = possibleWords.filter(word => word.length >= length);
  } else {
    // Words on stream only uses words with 4 or more letters
    possibleWords = possibleWords.filter(word => word.length > 3);
  }

  // Remove duplicates by converting to a Set and back to an array
  possibleWords = Array.from(new Set(possibleWords.map(word => word.toLowerCase())));

  // Sort words by length (descending)
  return possibleWords.sort((a, b) => b.length - a.length);
}
