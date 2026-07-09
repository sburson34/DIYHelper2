using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace DIYHelper2.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPriceBookAndQuotes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "QuoteLinesJson",
                table: "HelpRequests",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "QuoteRespondedAt",
                table: "HelpRequests",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "QuoteSentAt",
                table: "HelpRequests",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "QuoteStatus",
                table: "HelpRequests",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "QuoteTotal",
                table: "HelpRequests",
                type: "numeric(12,2)",
                precision: 12,
                scale: 2,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "PriceBookItems",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Brand = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    DefaultPrice = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PriceBookItems", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PriceBookItems_Brand_Active",
                table: "PriceBookItems",
                columns: new[] { "Brand", "IsActive" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PriceBookItems");

            migrationBuilder.DropColumn(
                name: "QuoteLinesJson",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "QuoteRespondedAt",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "QuoteSentAt",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "QuoteStatus",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "QuoteTotal",
                table: "HelpRequests");
        }
    }
}
