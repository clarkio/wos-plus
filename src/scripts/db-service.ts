export interface ChannelStats {
  allTimePersonalBest: number;
  dailyBest: number;
  dailyClears: number;
}

const defaultStats: ChannelStats = { allTimePersonalBest: 0, dailyBest: 0, dailyClears: 0 };

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
}

async function boardExists(boardId: string): Promise<boolean> {
  const url = `/api/boards/${encodeURIComponent(boardId)}`;
  const response = await fetch(url, {
    method: 'GET',
  });

  if (response.status === 404) {
    return false;
  }

  if (!response.ok) {
    throw new Error(`Failed to verify board existence: ${response.status} ${response.statusText}`);
  }

  return true;
}

export async function saveBoard(boardId: string, slots: Slot[]) {
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

  try {
    const exists = await boardExists(cleanBoardId);
    if (exists) {
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
