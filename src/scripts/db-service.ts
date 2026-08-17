import { findRedundantWords, hasInvalidWords, hasRedundantWords, normalizeLanguageCode, validateBoardName } from '../lib/board-utils';
import { normalizeTwitchLogin } from './twitch-channel';

export interface ChannelStats {
  allTimePersonalBest: number;
  dailyBest: number;
  dailyClears: number;
  // Whether the channel has the chatbot enabled (its Twitch username is in the
  // `users` table). Only chatbot-enabled channels get daily stats, so the UI
  // uses this to hide the daily best/clears components otherwise (issue #79).
  chatbotEnabled: boolean;
}

const defaultStats: ChannelStats = { allTimePersonalBest: 0, dailyBest: 0, dailyClears: 0, chatbotEnabled: false };

export async function fetchChannelStats(channel: string): Promise<ChannelStats> {
  const cleanChannel = normalizeTwitchLogin(channel);
  if (!cleanChannel) {
    console.warn('Cannot fetch channel stats: channel name is invalid.');
    return defaultStats;
  }

  try {
    const url = `/api/channel-stats/${encodeURIComponent(cleanChannel)}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`Failed to fetch channel stats: ${response.status} ${response.statusText}`);
      return defaultStats;
    }

    const data = await response.json();
    return {
      allTimePersonalBest: data.allTimePersonalBest ?? 0,
      dailyBest: data.dailyBest ?? 0,
      dailyClears: data.dailyClears ?? 0,
      chatbotEnabled: data.chatbotEnabled ?? false,
    };
  } catch (error) {
    console.error('Error fetching channel stats:', error);
    return defaultStats;
  }
}

export interface Slot {
  letters: string[];
  user?: string | null;
  hitMax: boolean;
  originalIndex?: number;
  word: string;
}

export interface Board {
  id: string;
  slots: Slot[];
  created_at: string;
  // Twitch channel the board was captured from; null for boards saved before
  // the column existed.
  twitch_channel?: string | null;
  // When the board row was last updated; stamped by a database trigger on any
  // UPDATE (see db-scripts/add-updated-at-to-boards.sql). Null for boards that
  // have never been updated since being saved.
  updated_at?: string | null;
  // Two-letter code for the language of the board's words ('en', 'pt' or
  // 'fr'), captured from the WoS game instance (issue #124). Boards saved
  // before the column existed default to 'en' — the only language WoS+
  // supported at the time.
  language_code?: string | null;
}

async function fetchExistingBoard(boardId: string): Promise<{ exists: boolean; board: Board | null }> {
  const url = `/api/boards/${encodeURIComponent(boardId)}`;
  const response = await fetch(url, {
    method: 'GET',
  });

  if (response.status === 404) {
    return { exists: false, board: null };
  }

  if (!response.ok) {
    throw new Error(`Failed to verify board existence: ${response.status} ${response.statusText}`);
  }

  // The board exists; if its body can't be read we still report existence so
  // the caller falls back to the safe "already saved" path.
  try {
    return { exists: true, board: await response.json() };
  } catch {
    return { exists: true, board: null };
  }
}

// Replaces the slots of an already-stored board that was saved with corrupted
// words (issues #119 and #195). The server only accepts this update when the
// stored board is actually corrupted, so a clean board can never be overwritten.
async function updateBoardSlots(boardId: string, slots: Slot[], twitchChannel: string | null, languageCode: string) {
  try {
    const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        slots,
        language_code: languageCode,
        ...(twitchChannel ? { twitch_channel: twitchChannel } : {}),
      }),
    });

    if (!response.ok) {
      let errorBody: any = null;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = null;
      }

      const apiMessage = errorBody?.message || errorBody?.error;
      throw new Error(apiMessage || `Network response was not ok: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`Board ${boardId} updated with clean slots:`, data);
    return data;
  } catch (error) {
    console.error('Error updating board with clean slots:', error);
  }
}

function storedBoardCorruptionReason(board: Board | null, boardId: string): 'redundant words' | 'invalid words' | null {
  if (!board) return null;
  if (hasRedundantWords(board.slots)) return 'redundant words';
  if (hasInvalidWords(board.slots, boardId)) return 'invalid words';
  return null;
}

function clientBoardIdWarning(error: string): string {
  if (error === 'Board ID is required') {
    return 'boardId must be a non-empty string.';
  }
  if (error === 'Invalid board ID format. Only letters are allowed.') {
    return 'boardId contains invalid characters. Only letters are allowed.';
  }
  if (error === 'Invalid board ID length. Must be between 4 and 12 characters.') {
    return 'boardId length must be between 4 and 12 characters.';
  }
  return error;
}

export async function saveBoard(boardId: string, slots: Slot[], twitchChannel?: string, languageCode?: string) {
  const boardName = validateBoardName(boardId);
  if ('error' in boardName) {
    console.warn(`Cannot save board: ${clientBoardIdWarning(boardName.error)}`);
    return;
  }
  const { cleanId: cleanBoardId } = boardName;

  // Validate slots array
  if (!Array.isArray(slots) || slots.length === 0) {
    console.warn('Cannot save board: slots must be a non-empty array.');
    return;
  }

  // Validate each slot has required properties
  const isValidSlots = slots.every(slot =>
    slot &&
    typeof slot === 'object' &&
    Array.isArray(slot.letters) &&
    typeof slot.hitMax === 'boolean' &&
    typeof slot.word === 'string'
  );

  if (!isValidSlots) {
    console.warn('Cannot save board: invalid slot structure detected.');
    return;
  }

  console.log(slots);
  const url = '/api/boards';
  const isMissingWords: boolean = slots.some(slot => slot.letters.includes('.') || slot.letters.includes('?') || slot.word.length === 0);

  if (isMissingWords) {
    console.warn('Cannot save board: some words are incomplete.');
    return;
  }

  // Guard (issue #119): every slot on a board is a distinct word, so slots
  // containing the same word more than once are corrupted capture data and
  // must never reach the database.
  const redundantWords = findRedundantWords(slots);
  if (redundantWords.length > 0) {
    const redundantMessage = `Cannot save board ${cleanBoardId}: redundant words detected in slots: ${redundantWords.join(', ')}.`;
    console.warn(redundantMessage);
    return {
      error: 'Redundant words in board slots',
      message: redundantMessage,
      code: 'REDUNDANT_WORDS',
    };
  }

  // The channel is informational metadata: an invalid or missing value is
  // dropped rather than blocking the save.
  const cleanTwitchChannel = normalizeTwitchLogin(twitchChannel);
  if (twitchChannel !== undefined && cleanTwitchChannel === null) {
    console.warn('Saving board without twitch channel: channel name is invalid.');
  }

  // The word language, unlike the channel, is not informational (issue #161):
  // a board's words only mean anything alongside the language they were
  // played in, so a fresh save requires one of the languages WoS actually
  // plays in. A repair (the self-healing branch below) keeps the pre-#161
  // fallback, since a repair carrying no language is meant to leave the
  // stored value alone rather than fail.
  const requestedLanguageCode = normalizeLanguageCode(languageCode);

  try {
    const { exists, board: existingBoard } = await fetchExistingBoard(cleanBoardId);
    if (exists) {
      // Self-healing (issues #119 and #195): if the stored copy of this board
      // has redundant or impossible words, replace its slots with this clean
      // capture instead of skipping the save.
      const corruptionReason = storedBoardCorruptionReason(existingBoard, cleanBoardId);
      if (corruptionReason) {
        console.warn(`Board ${cleanBoardId} exists with ${corruptionReason}; updating it with the clean version.`);
        return await updateBoardSlots(cleanBoardId, slots, cleanTwitchChannel, requestedLanguageCode ?? 'en');
      }

      const duplicateMessage = `Board ${cleanBoardId} has already been saved.`;
      console.warn(duplicateMessage);
      return {
        error: 'Board already exists',
        message: duplicateMessage,
        code: 'BOARD_EXISTS',
      };
    }
  } catch (error) {
    // If the pre-check fails, continue with POST and let API validation handle conflicts.
    console.warn('Unable to verify whether board exists before save; proceeding with save attempt.', error);
  }

  if (!requestedLanguageCode) {
    const rejectMessage = `Cannot save board ${cleanBoardId}: a supported word language (en, pt or fr) is required.`;
    console.warn(rejectMessage);
    return {
      error: 'Unsupported or missing word language',
      message: rejectMessage,
      code: 'INVALID_LANGUAGE',
    };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: cleanBoardId,
        slots: slots,
        created_at: new Date().toISOString(),
        language_code: requestedLanguageCode,
        ...(cleanTwitchChannel ? { twitch_channel: cleanTwitchChannel } : {}),
      }),
    });

    if (response.status === 409) {
      let duplicateBody: any = null;
      try {
        duplicateBody = await response.json();
      } catch {
        duplicateBody = {
          message: `Board ${cleanBoardId} has already been saved.`,
          code: 'BOARD_EXISTS',
        };
      }

      console.warn(duplicateBody?.message || `Board ${cleanBoardId} has already been saved.`);
      return duplicateBody;
    }

    if (!response.ok) {
      let errorBody: any = null;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = null;
      }

      const apiMessage = errorBody?.message || errorBody?.error;
      throw new Error(apiMessage || `Network response was not ok: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`Board ${cleanBoardId} saved successfully:`, data);
    return data;
  } catch (error) {
    console.error('Error saving board to Cloudflare Worker:', error);
  }
}

export async function fetchBoard(boardId: string): Promise<Board | null> {
  const boardName = validateBoardName(boardId);
  if ('error' in boardName) {
    console.warn(`Cannot fetch board: ${clientBoardIdWarning(boardName.error)}`);
    return null;
  }
  const { cleanId: cleanBoardId } = boardName;

  try {
    const url = `/api/boards/${encodeURIComponent(cleanBoardId)}`;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`Board ${cleanBoardId} not found in database.`);
        return null;
      }
      throw new Error(`Network response was not ok: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`Board ${cleanBoardId} fetched successfully:`, data);
    return data;
  } catch (error) {
    console.error('Error fetching board:', error);
    return null;
  }
}
