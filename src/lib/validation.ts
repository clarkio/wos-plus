/**
 * Validation utilities for API request bodies
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Slot structure for board data
 */
export interface SlotInput {
  letters: string[];
  word: string;
  hitMax: boolean;
  user?: string | null;
  originalIndex?: number;
  index?: number;
  length?: number;
}

/**
 * Board input structure
 */
export interface BoardInput {
  id: string;
  slots: SlotInput[];
  created_at?: string;
}

// Maximum allowed lengths to prevent abuse
const MAX_BOARD_ID_LENGTH = 20;
const MAX_WORD_LENGTH = 20;
const MAX_SLOTS_COUNT = 50;
const MAX_USERNAME_LENGTH = 100;

// Valid patterns
const BOARD_ID_PATTERN = /^[A-Z]+$/;
const WORD_PATTERN = /^[a-zA-Z]*$/;
const LETTER_PATTERN = /^[a-zA-Z.?]$/;

/**
 * Validates a board input object
 */
export function validateBoardInput(input: unknown): ValidationResult {
  // Check if input is an object
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Request body must be an object' };
  }

  const body = input as Record<string, unknown>;

  // Validate id field
  if (typeof body.id !== 'string') {
    return { valid: false, error: 'Field "id" must be a string' };
  }

  if (body.id.length === 0) {
    return { valid: false, error: 'Field "id" cannot be empty' };
  }

  if (body.id.length > MAX_BOARD_ID_LENGTH) {
    return { valid: false, error: `Field "id" exceeds maximum length of ${MAX_BOARD_ID_LENGTH}` };
  }

  // Normalize and validate board ID format (uppercase letters only)
  const normalizedId = body.id.replace(/\s+/g, '').toUpperCase();
  if (!BOARD_ID_PATTERN.test(normalizedId)) {
    return { valid: false, error: 'Field "id" must contain only letters (A-Z)' };
  }

  // Validate slots array
  if (!Array.isArray(body.slots)) {
    return { valid: false, error: 'Field "slots" must be an array' };
  }

  if (body.slots.length === 0) {
    return { valid: false, error: 'Field "slots" cannot be empty' };
  }

  if (body.slots.length > MAX_SLOTS_COUNT) {
    return { valid: false, error: `Field "slots" exceeds maximum count of ${MAX_SLOTS_COUNT}` };
  }

  // Validate each slot
  for (let i = 0; i < body.slots.length; i++) {
    const slotResult = validateSlot(body.slots[i], i);
    if (!slotResult.valid) {
      return slotResult;
    }
  }

  // Validate created_at if provided
  if (body.created_at !== undefined) {
    if (typeof body.created_at !== 'string') {
      return { valid: false, error: 'Field "created_at" must be a string' };
    }
    const date = new Date(body.created_at);
    if (isNaN(date.getTime())) {
      return { valid: false, error: 'Field "created_at" must be a valid ISO date string' };
    }
  }

  return { valid: true };
}

/**
 * Validates a single slot object
 */
function validateSlot(slot: unknown, index: number): ValidationResult {
  if (!slot || typeof slot !== 'object') {
    return { valid: false, error: `Slot at index ${index} must be an object` };
  }

  const s = slot as Record<string, unknown>;

  // Validate letters array
  if (!Array.isArray(s.letters)) {
    return { valid: false, error: `Slot ${index}: "letters" must be an array` };
  }

  if (s.letters.length === 0 || s.letters.length > MAX_WORD_LENGTH) {
    return { valid: false, error: `Slot ${index}: "letters" must have 1-${MAX_WORD_LENGTH} elements` };
  }

  for (let j = 0; j < s.letters.length; j++) {
    if (typeof s.letters[j] !== 'string' || !LETTER_PATTERN.test(s.letters[j])) {
      return { valid: false, error: `Slot ${index}: letter at position ${j} must be a single letter, ".", or "?"` };
    }
  }

  // Validate word field
  if (typeof s.word !== 'string') {
    return { valid: false, error: `Slot ${index}: "word" must be a string` };
  }

  if (s.word.length > MAX_WORD_LENGTH) {
    return { valid: false, error: `Slot ${index}: "word" exceeds maximum length of ${MAX_WORD_LENGTH}` };
  }

  if (!WORD_PATTERN.test(s.word)) {
    return { valid: false, error: `Slot ${index}: "word" must contain only letters` };
  }

  // Validate hitMax field
  if (typeof s.hitMax !== 'boolean') {
    return { valid: false, error: `Slot ${index}: "hitMax" must be a boolean` };
  }

  // Validate optional user field
  if (s.user !== undefined && s.user !== null) {
    if (typeof s.user !== 'string') {
      return { valid: false, error: `Slot ${index}: "user" must be a string or null` };
    }
    if (s.user.length > MAX_USERNAME_LENGTH) {
      return { valid: false, error: `Slot ${index}: "user" exceeds maximum length of ${MAX_USERNAME_LENGTH}` };
    }
  }

  // Validate optional index fields (must be non-negative integers)
  if (s.originalIndex !== undefined) {
    if (typeof s.originalIndex !== 'number' || !Number.isInteger(s.originalIndex) || s.originalIndex < 0) {
      return { valid: false, error: `Slot ${index}: "originalIndex" must be a non-negative integer` };
    }
  }

  if (s.index !== undefined) {
    if (typeof s.index !== 'number' || !Number.isInteger(s.index) || s.index < 0) {
      return { valid: false, error: `Slot ${index}: "index" must be a non-negative integer` };
    }
  }

  if (s.length !== undefined) {
    if (typeof s.length !== 'number' || !Number.isInteger(s.length) || s.length < 0) {
      return { valid: false, error: `Slot ${index}: "length" must be a non-negative integer` };
    }
  }

  return { valid: true };
}

/**
 * Sanitizes a board input by normalizing values
 * Call this after validation passes
 */
export function sanitizeBoardInput(input: BoardInput): BoardInput {
  return {
    id: input.id.replace(/\s+/g, '').toUpperCase(),
    slots: input.slots.map(slot => ({
      letters: slot.letters.map(l => l.toLowerCase()),
      word: slot.word.toLowerCase(),
      hitMax: slot.hitMax,
      user: slot.user ?? null,
      ...(slot.originalIndex !== undefined && { originalIndex: slot.originalIndex }),
      ...(slot.index !== undefined && { index: slot.index }),
      ...(slot.length !== undefined && { length: slot.length }),
    })),
    created_at: input.created_at ?? new Date().toISOString(),
  };
}

/**
 * Validates a word input for the words API
 */
export function validateWordInput(input: unknown): ValidationResult {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Request body must be an object' };
  }

  const body = input as Record<string, unknown>;

  if (typeof body.word !== 'string') {
    return { valid: false, error: 'Field "word" must be a string' };
  }

  if (body.word.length === 0) {
    return { valid: false, error: 'Field "word" cannot be empty' };
  }

  if (body.word.length > MAX_WORD_LENGTH) {
    return { valid: false, error: `Field "word" exceeds maximum length of ${MAX_WORD_LENGTH}` };
  }

  if (!WORD_PATTERN.test(body.word)) {
    return { valid: false, error: 'Field "word" must contain only letters' };
  }

  return { valid: true };
}
