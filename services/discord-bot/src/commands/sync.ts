import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { buildDiscordUserHeaders, fetchNexusApi } from "../utils.js";

export const data = new SlashCommandBuilder()
  .setName("sync")
  .setDescription("Trigger a Schwab broker sync")
  .addStringOption((opt) =>
    opt
      .setName("account")
      .setDescription("Schwab account ID")
      .setRequired(true),
  );

interface SyncResult {
  tradesImported: number;
  warnings?: string[];
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const accountId = interaction.options.getString("account", true);

  try {
    const result = await fetchNexusApi<SyncResult>("/api/schwab/sync", {
      method: "POST",
      body: { accountId },
      headers: buildDiscordUserHeaders(interaction.user.id, interaction.guildId),
    });

    const embed = new EmbedBuilder()
      .setTitle("Schwab Sync")
      .setTimestamp();

    embed
      .setColor(0x22c55e)
      .setDescription("Sync completed successfully.")
      .addFields({
        name: "Trades Imported",
        value: String(result.tradesImported ?? 0),
        inline: true,
      });

    if (result.warnings && result.warnings.length > 0) {
      embed.addFields({
        name: "Warnings",
        value: result.warnings.slice(0, 5).join("\n"),
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply(`Sync request failed: ${message}`);
  }
}
