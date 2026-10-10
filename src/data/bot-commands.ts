/**
 * The WoS+ Bot chat commands, as shown on /bot/commands.
 *
 * The bot's `!help` reply links to that page instead of pasting every command
 * into chat. This list is hand-copied from the command handlers in the
 * clarkio/wos-plus-bot repository (`src/commands/handlers/*.ts`), so a command
 * added, renamed or changed there needs a matching edit here.
 * `tests/unit/bot-commands.test.ts` pins the command set so drift is a
 * deliberate change, not a silent one.
 */

export interface BotCommand {
  /** Primary name, without the `!` prefix. */
  name: string;
  /** Alternative triggers, without the `!` prefix. */
  aliases: string[];
  /** How to type it, e.g. `!define <word>`. */
  usage: string;
  /** One or two sentences on what it does. */
  description: string;
  /** Extra details worth knowing (limits, defaults, who can use a sub-command). */
  notes?: string[];
  /** Only the broadcaster and the channel's moderators can use it. */
  modsOnly?: boolean;
}

export interface BotCommandGroup {
  /** Anchor id on the page. */
  id: string;
  title: string;
  blurb: string;
  commands: BotCommand[];
}

export const BOT_COMMAND_GROUPS: BotCommandGroup[] = [
  {
    id: 'game',
    title: 'Play the game',
    blurb:
      'Anyone in chat can drive Words on Stream with these, as long as the bot is connected to the game. Right after a level ends, viewers wait a few seconds (see !setcooldown) so the next level is ready; the broadcaster and moderators skip the wait.',
    commands: [
      {
        name: 'start',
        aliases: ['s'],
        usage: '!start',
        description: 'Start a game of Words on Stream.',
      },
      {
        name: 'continue',
        aliases: ['c'],
        usage: '!continue',
        description: 'Continue to the next level.',
      },
      {
        name: 'restart',
        aliases: ['r'],
        usage: '!restart',
        description: 'Restart the game.',
      },
    ],
  },
  {
    id: 'words-stats',
    title: 'Words and stats',
    blurb: 'Look things up while you play.',
    commands: [
      {
        name: 'define',
        aliases: ['def', 'definition', 'd'],
        usage: '!define <word>',
        description: 'Get the definition of a word, straight from the dictionary.',
      },
      {
        name: 'clearstreak',
        aliases: ['streak', 'clears'],
        usage: '!clearstreak',
        description:
          "Show the channel's consecutive board clears: the current streak, today's best, and the all-time best.",
      },
    ],
  },
  {
    id: 'links-info',
    title: 'Links and info',
    blurb: 'Find the game, the WoS+ view, and the bot itself.',
    commands: [
      {
        name: 'mirror',
        aliases: ['wos', 'wosmirror'],
        usage: '!mirror',
        description: "Get the Words on Stream mirror link for this channel's game.",
        notes: [
          'Broadcaster and moderators: !mirror set <url> saves the mirror link the bot follows.',
        ],
      },
      {
        name: 'wmirror',
        aliases: ['wosplus'],
        usage: '!wmirror',
        description:
          "Get a wosplus.com player view link for this channel's game, with chat and the board already turned on.",
      },
      {
        name: 'ping',
        aliases: ['p'],
        usage: '!ping',
        description: 'Check the bot is online. It replies "Pong!".',
      },
      {
        name: 'help',
        aliases: ['h', 'commands'],
        usage: '!help [command]',
        description:
          'Get a link to this page. Add a command name, like !help define, to get a one-line description of just that command.',
      },
    ],
  },
  {
    id: 'connection',
    title: 'Connect to the game',
    blurb: 'For the broadcaster and moderators. The bot normally connects on its own once a mirror link is set.',
    commands: [
      {
        name: 'wosconnect',
        aliases: ['wsc'],
        usage: '!wosconnect',
        description: 'Connect the bot to the Words on Stream game.',
        notes: ['Needs a mirror link first: !mirror set <url>.'],
        modsOnly: true,
      },
      {
        name: 'wosdisconnect',
        aliases: ['wsd'],
        usage: '!wosdisconnect',
        description: 'Disconnect the bot from the Words on Stream game feed.',
        modsOnly: true,
      },
    ],
  },
  {
    id: 'game-controls',
    title: 'Game controls',
    blurb: 'For the broadcaster and moderators: decide who can drive the game, and when.',
    commands: [
      {
        name: 'enablecr',
        aliases: [],
        usage: '!enablecr',
        description: 'Turn !start, !continue and !restart back on for chat.',
        modsOnly: true,
      },
      {
        name: 'disablecr',
        aliases: ['pause'],
        usage: '!disablecr',
        description: 'Turn off !start, !continue and !restart for chat, and stop auto continue/restart.',
        modsOnly: true,
      },
      {
        name: 'enable',
        aliases: [],
        usage: '!enable <command>',
        description: 'Turn a single game command back on.',
        notes: ['Works with continue and restart.'],
        modsOnly: true,
      },
      {
        name: 'disable',
        aliases: [],
        usage: '!disable <command>',
        description: 'Turn off a single game command for chat.',
        notes: ['Works with continue and restart.'],
        modsOnly: true,
      },
      {
        name: 'autocr',
        aliases: [],
        usage: '!autocr [seconds|off]',
        description:
          'Have the bot send !continue a few seconds after each level ends and !restart after the game ends, so nobody has to.',
        notes: ['Seconds can be 12 to 60; the default is 12. Use !autocr off to stop.'],
        modsOnly: true,
      },
      {
        name: 'setcooldown',
        aliases: ['cd'],
        usage: '!setcooldown [seconds]',
        description:
          'Set how long viewers wait after a level ends before !start, !continue and !restart work again. Leave the number off to see the current wait.',
        notes: ['Seconds can be 12 to 60.'],
        modsOnly: true,
      },
    ],
  },
  {
    id: 'announcements',
    title: 'Chat announcements',
    blurb: 'For the broadcaster and moderators: choose what the bot posts in chat during a game.',
    commands: [
      {
        name: 'missedwords',
        aliases: ['mw', 'missedwordsmsg'],
        usage: '!missedwords [on|off]',
        description:
          'Turn the list of words nobody found at the end of a level on or off. Leave it blank to see the current setting.',
        modsOnly: true,
      },
      {
        name: 'unlockmsg',
        aliases: ['unlockedmsg'],
        usage: '!unlockmsg [on|off]',
        description:
          'Turn the *** PLAYERS UNLOCKED *** announcement on or off. Leave it blank to see the current setting.',
        modsOnly: true,
      },
      {
        name: 'setbigwordinterval',
        aliases: ['bwi'],
        usage: '!setbigwordinterval [seconds]',
        description:
          'Set how often the big word announcement repeats in chat. Use 0 to post it once. Leave it blank to see the current setting.',
        notes: ['Seconds can be 0 to 300.'],
        modsOnly: true,
      },
    ],
  },
];

/** Every command on the page, in display order. */
export function allBotCommands(): BotCommand[] {
  return BOT_COMMAND_GROUPS.flatMap((group) => group.commands);
}
