import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { fetchNexusApi } from "../utils.js";

export const data = new SlashCommandBuilder()
  .setName("sync")
  .setDescription("Trigger a Schwab broker sync");

interface SyncResult {
  success: boolean;
  message?: string;
  tradesImported?: number;
  errors?: string[];
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  try {
    const result = await fetchNexusApi<SyncResult>("/api/schwab/sync", {
      method: "POST",
    });

    const embed = new EmbedBuilder()
      .setTitle("Schwab Sync")
      .setTimestamp();

    if (result.success) {
      embed
        .setColor(0x22c55e)
        .setDescription("Sync completed successfully.")
        .addFields({
          name: "Trades Imported",
          value: (result.tradesImported ?? 0).toString(),
          inline: true,
        });

      if (result.message) {
        embed.addFields({ name: "Details", value: result.message });
      }
    } else {
      embed
        .setColor(0xef4444)
        .setDescription("Sync failed.");

      if (result.message) {
        embed.addFields({ name: "Error", value: result.message });
      }
      if (result.errors && result.errors.length > 0) {
        embed.addFields({
          name: "Errors",
          value: result.errors.slice(0, 5).join("\n"),
        });
      }
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply(`Sync request failed: ${message}`);
  }
}
