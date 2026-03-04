import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import {
  buildDiscordUserHeaders,
  createTradeEmbed,
  fetchNexusApi,
  formatCurrency,
  pnlColor,
  SERVICE_SCOPE,
  type Trade,
} from "../utils.js";

export const data = new SlashCommandBuilder()
  .setName("journal")
  .setDescription("Show trades for a specific date")
  .addStringOption((opt) =>
    opt
      .setName("date")
      .setDescription("Date in YYYY-MM-DD format (defaults to today)")
      .setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const dateInput =
    interaction.options.getString("date") ??
    new Date().toISOString().slice(0, 10);

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    await interaction.editReply("Invalid date format. Please use YYYY-MM-DD.");
    return;
  }

  try {
    const response = await fetchNexusApi<{ trades: Trade[] }>(
      "/api/trades",
      {
        headers: buildDiscordUserHeaders(
          interaction.user.id,
          interaction.guildId,
          [SERVICE_SCOPE.TRADES_READ],
        ),
      },
    );
    const trades = (response.trades ?? []).filter((trade) => {
      const dateKey = trade.sortKey ?? trade.date?.slice(0, 10);
      return dateKey === dateInput;
    });

    if (!trades || trades.length === 0) {
      await interaction.editReply(`No trades found for **${dateInput}**.`);
      return;
    }

    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const winners = trades.filter((t) => t.pnl > 0).length;
    const losers = trades.filter((t) => t.pnl < 0).length;

    const summary = new EmbedBuilder()
      .setTitle(`Trade Journal — ${dateInput}`)
      .setColor(pnlColor(totalPnl))
      .setDescription(
        `**${trades.length}** trade${trades.length === 1 ? "" : "s"} | ` +
          `${winners}W / ${losers}L | ` +
          `Net PnL: **${formatCurrency(totalPnl)}**`,
      )
      .setTimestamp();

    // Add up to 25 fields (Discord embed limit)
    const embeds: EmbedBuilder[] = [summary];

    for (const trade of trades.slice(0, 10)) {
      embeds.push(createTradeEmbed(trade));
    }

    if (trades.length > 10) {
      summary.setFooter({
        text: `Showing 10 of ${trades.length} trades`,
      });
    }

    await interaction.editReply({ embeds });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply(`Failed to fetch trades: ${message}`);
  }
}
