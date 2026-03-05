import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { buildDiscordUserHeaders, fetchNexusApi, getNexusApiUrl, SERVICE_SCOPE } from "../utils.js";

type LinkCodeResponse = {
  code: string;
  expiresAt: string;
  ttlMinutes: number;
};

export const data = new SlashCommandBuilder()
  .setName("link")
  .setDescription("Link your Discord account to Nexus Terminal");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  if (!interaction.guildId) {
    await interaction.editReply("This command must be run inside a Discord server.");
    return;
  }

  try {
    const response = await fetchNexusApi<LinkCodeResponse>("/api/discord/link/code", {
      method: "POST",
      headers: buildDiscordUserHeaders(interaction.user.id, interaction.guildId, [SERVICE_SCOPE.LINK_CODE_CREATE]),
    });

    const baseUrl = getNexusApiUrl().replace(/\/+$/, "");
    const linkUrl = `${baseUrl}/discord/link`;

    const embed = new EmbedBuilder()
      .setTitle("Link Nexus Terminal")
      .setColor(0x22c55e)
      .setDescription("Use the code below in Nexus Terminal to complete account linking.")
      .addFields(
        { name: "Code", value: `\`${response.code}\``, inline: true },
        { name: "Expires", value: `<t:${Math.floor(new Date(response.expiresAt).getTime() / 1000)}:R>`, inline: true },
        { name: "Link Page", value: `[Click here to link](${linkUrl})` },
      )
      .setFooter({ text: "If code expires, run /link again." });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    const text = error instanceof Error ? error.message : "Could not generate link code";
    await interaction.editReply(`Link request failed: ${text}`);
  }
}
