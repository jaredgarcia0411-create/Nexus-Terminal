import "dotenv/config";
import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  type ChatInputCommandInteraction,
  type SlashCommandBuilder,
} from "discord.js";

// Command imports
import * as journalCmd from "./commands/journal.js";
import * as statsCmd from "./commands/stats.js";
import * as pnlCmd from "./commands/pnl.js";
import * as alertCmd from "./commands/alert.js";
import * as linkCmd from "./commands/link.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Command {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const commands = new Collection<string, Command>();

const allCommands: Command[] = [
  journalCmd as unknown as Command,
  statsCmd as unknown as Command,
  pnlCmd as unknown as Command,
  alertCmd as unknown as Command,
  linkCmd as unknown as Command,
];

for (const cmd of allCommands) {
  commands.set(cmd.data.name, cmd);
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ---------------------------------------------------------------------------
// Register slash commands on ready
// ---------------------------------------------------------------------------

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[nexus-bot] Logged in as ${readyClient.user.tag}`);

  const token = process.env.DISCORD_BOT_TOKEN!;
  const clientId = process.env.DISCORD_CLIENT_ID!;
  const guildId = process.env.DISCORD_GUILD_ID;

  const rest = new REST().setToken(token);
  const commandData = allCommands.map((c) => c.data.toJSON());

  try {
    if (guildId) {
      // Guild-specific (instant update — great for development)
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commandData,
      });
      console.log(`[nexus-bot] Registered ${commandData.length} guild commands`);
    } else {
      // Global (may take up to an hour to propagate)
      await rest.put(Routes.applicationCommands(clientId), {
        body: commandData,
      });
      console.log(`[nexus-bot] Registered ${commandData.length} global commands`);
    }
  } catch (err) {
    console.error("[nexus-bot] Failed to register commands:", err);
  }
});

// ---------------------------------------------------------------------------
// Interaction handler
// ---------------------------------------------------------------------------

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);

  if (!command) {
    console.warn(`[nexus-bot] Unknown command: ${interaction.commandName}`);
    await interaction.reply({
      content: "Unknown command.",
      ephemeral: true,
    });
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`[nexus-bot] Error executing /${interaction.commandName}:`, error);

    const message = "Something went wrong while running that command.";
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, ephemeral: true });
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  }
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("[nexus-bot] DISCORD_BOT_TOKEN is not set. Exiting.");
  process.exit(1);
}

client.login(token);
