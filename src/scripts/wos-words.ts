// import localDictionary from './wos_dictionary.json';
let wosDictionary: string[]; // = localDictionary as string[];

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
 * @param length Optional parameter to filter words by minimum length
 * @returns Array of words sorted by length (longest first)
 */
export function findWosWordsByLetters(letters: string, length?: number): string[] {
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

/**
 * Slot type used for grouping empty slots
 */
export interface SlotInfo {
  letters: string[];
  word?: string;
  user?: string;
  hitMax: boolean;
  index: number;
  length: number;
}

/**
 * Represents a group of consecutive empty slots with boundary information
 */
export interface EmptySlotGroup {
  slots: { index: number; length: number }[];
  lowerBoundIndex: number | null;
  upperBoundIndex: number | null;
}

/**
 * Groups consecutive empty slots together and identifies boundary information.
 * Words on Stream sorts words alphabetically, so knowing the filled slots
 * adjacent to empty slots helps narrow down which words could fit.
 * 
 * @param slots The array of all slots for the current level
 * @returns Array of EmptySlotGroup, each containing consecutive empty slots and their boundaries
 */
export function groupConsecutiveEmptySlots(slots: SlotInfo[]): EmptySlotGroup[] {
  // Filter to empty slots only (slots without a user)
  const emptySlotInfos = slots
    .filter((slot) => !slot.user)
    .map((slot) => ({
      index: slot.index,
      length: slot.length,
    }));

  if (emptySlotInfos.length === 0) return [];

  const groups: EmptySlotGroup[] = [];
  let currentGroup: { index: number; length: number }[] = [emptySlotInfos[0]];

  for (let i = 1; i < emptySlotInfos.length; i++) {
    if (emptySlotInfos[i].index === emptySlotInfos[i - 1].index + 1) {
      // Consecutive, add to current group
      currentGroup.push(emptySlotInfos[i]);
    } else {
      // Not consecutive, finalize current group and start new one
      groups.push(createGroupWithBounds(currentGroup, slots));
      currentGroup = [emptySlotInfos[i]];
    }
  }
  // Don't forget the last group
  groups.push(createGroupWithBounds(currentGroup, slots));

  return groups;
}

/**
 * Creates an EmptySlotGroup with boundary information
 */
function createGroupWithBounds(
  groupSlots: { index: number; length: number }[],
  allSlots: SlotInfo[]
): EmptySlotGroup {
  const firstIndex = groupSlots[0].index;
  const lastIndex = groupSlots[groupSlots.length - 1].index;

  // Create an index map for O(1) slot lookups
  const slotByIndex = new Map<number, SlotInfo>();
  for (const slot of allSlots) {
    slotByIndex.set(slot.index, slot);
  }

  // Find lower bound: nearest filled slot before this group
  let lowerBoundIndex: number | null = null;
  for (let i = firstIndex - 1; i >= 0; i--) {
    const slot = slotByIndex.get(i);
    if (slot && slot.user) {
      lowerBoundIndex = i;
      break;
    }
  }

  // Find upper bound: nearest filled slot after this group
  let upperBoundIndex: number | null = null;
  const maxIndex = Math.max(...allSlots.map(s => s.index));
  for (let i = lastIndex + 1; i <= maxIndex; i++) {
    const slot = slotByIndex.get(i);
    if (slot && slot.user) {
      upperBoundIndex = i;
      break;
    }
  }

  return {
    slots: groupSlots,
    lowerBoundIndex,
    upperBoundIndex,
  };
}

/**
 * Checks if a word fits alphabetically between two boundary words.
 * Words on Stream arranges words alphabetically, so a missed word
 * must come after the lower bound and before the upper bound.
 * 
 * @param word The word to check
 * @param lowerBound The word at the lower boundary (or null if at start)
 * @param upperBound The word at the upper boundary (or null if at end)
 * @returns true if the word fits alphabetically between the bounds
 */
export function wordFitsAlphabetically(
  word: string,
  lowerBound: string | null,
  upperBound: string | null
): boolean {
  const wordLower = word.toLowerCase();

  // Check lower bound (word must come after lowerBound alphabetically)
  if (lowerBound !== null) {
    if (wordLower.localeCompare(lowerBound.toLowerCase()) <= 0) {
      return false;
    }
  }

  // Check upper bound (word must come before upperBound alphabetically)
  if (upperBound !== null) {
    if (wordLower.localeCompare(upperBound.toLowerCase()) >= 0) {
      return false;
    }
  }

  return true;
}

/**
 * Finds missed word candidates for an empty slot group based on
 * alphabetical ordering constraints and available letters.
 * 
 * @param group The empty slot group to find candidates for
 * @param lowerBoundWord The word at the lower boundary (or null)
 * @param upperBoundWord The word at the upper boundary (or null)
 * @param availableLetters The letters available to form words
 * @param correctlyGuessedWords Words already correctly guessed this level
 * @returns Array of candidate words grouped by slot length
 */
export function findSlotMatchedMissedWords(
  group: EmptySlotGroup,
  lowerBoundWord: string | null,
  upperBoundWord: string | null,
  availableLetters: string,
  correctlyGuessedWords: string[]
): { slotLength: number; candidates: string[] }[] {
  // Get unique lengths in this group
  const lengthsInGroup = [...new Set(group.slots.map((s) => s.length))];

  const results: { slotLength: number; candidates: string[] }[] = [];

  for (const length of lengthsInGroup) {
    // Get possible words from dictionary matching this length
    const possibleWords = findWosWordsByLetters(availableLetters, length)
      .filter((word) => word.length === length);

    // Filter out already guessed words (removing * suffix for comparison)
    const unguessedWords = possibleWords.filter(
      (word) =>
        !correctlyGuessedWords.some(
          (guessed) => guessed.replaceAll('*', '').toLowerCase() === word.toLowerCase()
        )
    );

    // Filter by alphabetical bounds
    const candidates = unguessedWords.filter((word) =>
      wordFitsAlphabetically(word, lowerBoundWord, upperBoundWord)
    );

    if (candidates.length > 0) {
      results.push({
        slotLength: length,
        candidates: candidates,
      });
    }
  }

  return results;
}
