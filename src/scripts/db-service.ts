import { findRedundantWords, hasRedundantWords, normalizeLanguageCode, normalizeTwitchChannel } from '../lib/board-utils';

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
  if (typeof channel !== 'string' || channel.length === 0) {
    console.warn('Cannot fetch channel stats: channel must be a non-empty string.');
    return defaultStats;
  }

  const cleanChannel = channel.toLowerCase().trim();

  if (!/^[a-z0-9_]+$/.test(cleanChannel)) {
    console.warn('Cannot fetch channel stats: channel contains invalid characters.');
    return defaultStats;
  }

  if (cleanChannel.length > 50) {
    console.warn('Cannot fetch channel stats: channel name too long.');
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

// Replaces the slots of an already-stored board that was saved with redundant
// words (issue #119). The server only accepts this update when the stored
// board is actually corrupted, so a clean board can never be overwritten.
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

export async function saveBoard(boardId: string, slots: Slot[], twitchChannel?: string, languageCode?: string) {
  // Validate boardId is a string and not too long
  if (typeof boardId !== 'string' || boardId.length === 0) {
    console.warn('Cannot save board: boardId must be a non-empty string.');
    return;
  }

  // Clean up big word (remove spaces if stored as "W O R D")
  const cleanBoardId = boardId.replace(/\s+/g, "").toUpperCase();

  // Security validation: only allow alphabetic characters
  if (!/^[A-Z]+$/.test(cleanBoardId)) {
    console.warn('Cannot save board: boardId contains invalid characters. Only letters are allowed.');
    return;
  }

  if (cleanBoardId.length < 4 || cleanBoardId.length > 20) {
    console.warn('Cannot save board: boardId length must be between 4 and 20 characters.');
    return;
  }

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

  if (isMissingWords === true) {
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
  const cleanTwitchChannel = normalizeTwitchChannel(twitchChannel);
  if (twitchChannel !== undefined && cleanTwitchChannel === null) {
    console.warn('Saving board without twitch channel: channel name is invalid.');
  }

  // Language is informational metadata too (issue #124): fall back to English
  // rather than blocking the save, since 'en' was the implicit language of
  // every board saved before language capture existed.
  const cleanLanguageCode = normalizeLanguageCode(languageCode) ?? 'en';
  if (languageCode !== undefined && normalizeLanguageCode(languageCode) === null) {
    console.warn(`Saving board with default language 'en': language code is invalid.`);
  }

  try {
    const { exists, board: existingBoard } = await fetchExistingBoard(cleanBoardId);
    if (exists) {
      // Self-healing (issue #119): if the stored copy of this board was saved
      // with redundant words, replace its slots with this clean capture
      // instead of skipping the save.
      if (existingBoard && hasRedundantWords(existingBoard.slots)) {
        console.warn(`Board ${cleanBoardId} exists with redundant words; updating it with the clean version.`);
        return await updateBoardSlots(cleanBoardId, slots, cleanTwitchChannel, cleanLanguageCode);
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
        language_code: cleanLanguageCode,
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
  if (typeof boardId !== 'string' || boardId.length === 0) {
    console.warn('Cannot fetch board: boardId must be a non-empty string.');
    return null;
  }

  // Clean up big word (remove spaces if stored as "W O R D")
  const cleanBoardId = boardId.replace(/\s+/g, "").toUpperCase();

  // Security validation: only allow alphabetic characters
  if (!/^[A-Z]+$/.test(cleanBoardId)) {
    console.warn('Cannot fetch board: boardId contains invalid characters. Only letters are allowed.');
    return null;
  }

  // Validate length to prevent abuse
  if (cleanBoardId.length < 4 || cleanBoardId.length > 20) {
    console.warn('Cannot fetch board: boardId length must be between 4 and 20 characters.');
    return null;
  }

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
