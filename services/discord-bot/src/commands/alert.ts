import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { fetchNexusApi, formatCurrency } from "../utils.js";

export const data = new SlashCommandBuilder()
  .setName("alert")
  .setDescription("Set a price alert for a symbol")
  .addStringOption((opt) =>
    opt
      .setName("symbol")
      .setDescription("Ticker symbol (e.g. AAPL)")
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("condition")
      .setDescription("Trigger condition")
      .setRequired(true)
      .addChoices(
        { name: "Above", value: "above" },
        { name: "Below", value: "below" },
      ),
  )
  .addNumberOption((opt) =>
    opt
      .setName("price")
      .setDescription("Target price")
      .setRequired(true),
  );

interface AlertResult {
  id?: string;
  success?: boolean;
  message?: string;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const symbol = interaction.options.getString("symbol", true).toUpperCase();
  const condition = interaction.options.getString("condition", true);
  const price = interaction.options.getNumber("price", true);

  try {
    const result = await fetchNexusApi<AlertResult>("/api/discord/alerts", {
      method: "POST",
      body: {
        symbol,
        condition,
        price,
        discordUserId: interaction.user.id,
        discordChannelId: interaction.channelId,
      },
    });

    const embed = new EmbedBuilder()
      .setTitle("Price Alert Set")
      .setColor(0x3b82f6) // blue
      .setDescription(
        `You will be notified when **${symbol}** goes **${condition}** ${formatCurrency(price).replace("+", "")}`,
      )
      .setTimestamp();

    if (result.id) {
      embed.setFooter({ text: `Alert ID: ${result.id}` });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply(`Failed to create alert: ${message}`);
  }
}
