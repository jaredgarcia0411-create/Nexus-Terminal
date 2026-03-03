import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { fetchNexusApi, formatCurrency, pnlColor, type Trade } from "../utils.js";

export const data = new SlashCommandBuilder()
  .setName("pnl")
  .setDescription("Cumulative PnL for a symbol")
  .addStringOption((opt) =>
    opt
      .setName("symbol")
      .setDescription("Ticker symbol (e.g. AAPL)")
      .setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const symbol = interaction.options.getString("symbol")?.toUpperCase() ?? null;

  try {
    const trades = await fetchNexusApi<Trade[]>("/api/trades");

    if (!trades || trades.length === 0) {
      await interaction.editReply("No trades found.");
      return;
    }

    if (symbol) {
      // Single-symbol breakdown
      const filtered = trades.filter(
        (t) => t.symbol.toUpperCase() === symbol,
      );

      if (filtered.length === 0) {
        await interaction.editReply(`No trades found for **${symbol}**.`);
        return;
      }

      const totalPnl = filtered.reduce((s, t) => s + (t.pnl ?? 0), 0);
      const tradeCount = filtered.length;
      const winners = filtered.filter((t) => t.pnl > 0).length;

      const embed = new EmbedBuilder()
        .setTitle(`PnL — ${symbol}`)
        .setColor(pnlColor(totalPnl))
        .addFields(
          { name: "Cumulative PnL", value: formatCurrency(totalPnl), inline: true },
          { name: "Trades", value: tradeCount.toString(), inline: true },
          {
            name: "Win Rate",
            value: `${((winners / tradeCount) * 100).toFixed(1)}%`,
            inline: true,
          },
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } else {
      // All-symbol summary
      const bySymbol = new Map<string, { pnl: number; count: number }>();

      for (const t of trades) {
        const key = t.symbol.toUpperCase();
        const entry = bySymbol.get(key) ?? { pnl: 0, count: 0 };
        entry.pnl += t.pnl ?? 0;
        entry.count += 1;
        bySymbol.set(key, entry);
      }

      // Sort by PnL descending
      const sorted = [...bySymbol.entries()].sort(
        (a, b) => b[1].pnl - a[1].pnl,
      );

      const totalPnl = sorted.reduce((s, [, v]) => s + v.pnl, 0);

      const lines = sorted.slice(0, 20).map(
        ([sym, v]) =>
          `**${sym}** — ${formatCurrency(v.pnl)} (${v.count} trade${v.count === 1 ? "" : "s"})`,
      );

      const embed = new EmbedBuilder()
        .setTitle("PnL by Symbol")
        .setColor(pnlColor(totalPnl))
        .setDescription(lines.join("\n"))
        .addFields({
          name: "Total",
          value: formatCurrency(totalPnl),
        })
        .setTimestamp();

      if (sorted.length > 20) {
        embed.setFooter({ text: `Showing 20 of ${sorted.length} symbols` });
      }

      await interaction.editReply({ embeds: [embed] });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply(`Failed to fetch PnL: ${message}`);
  }
}
