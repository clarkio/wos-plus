// import localDictionary from './wos_dictionary.json';
let wosDictionary: string[]; // = localDictionary as string[];

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
