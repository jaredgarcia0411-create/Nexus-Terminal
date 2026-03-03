/**
 * Standalone script to register slash commands with the Discord API.
 *
 * Usage:
 *   npx tsx src/deploy-commands.ts
 *   npm run deploy-commands
 */
import "dotenv/config";
import { REST, Routes } from "discord.js";

import * as journalCmd from "./commands/journal.js";
import * as statsCmd from "./commands/stats.js";
import * as pnlCmd from "./commands/pnl.js";
import * as syncCmd from "./commands/sync.js";
import * as alertCmd from "./commands/alert.js";
import * as backtestCmd from "./commands/backtest.js";

const commands = [
  journalCmd.data.toJSON(),
  statsCmd.data.toJSON(),
  pnlCmd.data.toJSON(),
  syncCmd.data.toJSON(),
  alertCmd.data.toJSON(),
  backtestCmd.data.toJSON(),
];

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  console.error("DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID must be set.");
  process.exit(1);
}

const rest = new REST().setToken(token);

async function main() {
  try {
    console.log(`Registering ${commands.length} slash commands...`);

    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commands,
      });
      console.log(`Successfully registered ${commands.length} guild commands.`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), {
        body: commands,
      });
      console.log(
        `Successfully registered ${commands.length} global commands (may take up to 1 hour to propagate).`,
      );
    }
  } catch (error) {
    console.error("Failed to register commands:", error);
    process.exit(1);
  }
}

main();
