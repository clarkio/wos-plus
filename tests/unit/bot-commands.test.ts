import { describe, it, expect } from 'vitest';
import { BOT_COMMAND_GROUPS, allBotCommands } from '../../src/data/bot-commands';

/**
 * The /bot/commands page is the reference the bot's `!help` reply sends
 * players to. Its data is hand-copied from the wos-plus-bot command handlers,
 * so these tests pin the set of commands: dropping one from the page, or a
 * new bot command landing without a page entry, has to be a deliberate edit
 * here rather than a silent drift.
 */
describe('bot command reference data', () => {
  it('lists every command the bot registers, once', () => {
    const names = allBotCommands().map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'autocr', 'clearstreak', 'continue', 'define', 'disable', 'disablecr',
        'enable', 'enablecr', 'help', 'mirror', 'missedwords', 'ping',
        'restart', 'setbigwordinterval', 'setcooldown', 'start', 'unlockmsg',
        'wmirror', 'wosconnect', 'wosdisconnect',
      ].sort(),
    );
  });

  it('never gives two commands the same trigger', () => {
    const triggers = allBotCommands().flatMap((c) => [c.name, ...c.aliases]);
    expect(new Set(triggers).size).toBe(triggers.length);
  });

  it('writes names and aliases without the ! prefix, which the page adds', () => {
    for (const c of allBotCommands()) {
      for (const trigger of [c.name, ...c.aliases]) {
        expect(trigger).toMatch(/^[a-z]+$/);
      }
    }
  });

  it('shows each usage line starting with the command it documents', () => {
    for (const c of allBotCommands()) {
      expect(c.usage.startsWith(`!${c.name}`)).toBe(true);
    }
  });

  it('marks the settings commands as broadcaster/moderator only', () => {
    const modsOnly = allBotCommands().filter((c) => c.modsOnly).map((c) => c.name).sort();
    expect(modsOnly).toEqual(
      [
        'autocr', 'disable', 'disablecr', 'enable', 'enablecr', 'missedwords',
        'setbigwordinterval', 'setcooldown', 'unlockmsg', 'wosconnect',
        'wosdisconnect',
      ].sort(),
    );
  });

  it('gives every group a unique anchor id and at least one command', () => {
    const ids = BOT_COMMAND_GROUPS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of BOT_COMMAND_GROUPS) {
      expect(g.commands.length).toBeGreaterThan(0);
    }
  });
});
