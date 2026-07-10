using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace DIYHelper2.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSelfScheduling : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BusinessHoursJson",
                table: "Brands",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SlotCapacity",
                table: "Brands",
                type: "integer",
                nullable: true);

            // Hand-edited defaults (EF scaffolds 0 / ""): existing brand rows
            // must backfill to the model's CLR defaults, not zero values.
            migrationBuilder.AddColumn<int>(
                name: "SlotMinutes",
                table: "Brands",
                type: "integer",
                nullable: false,
                defaultValue: 120);

            migrationBuilder.AddColumn<string>(
                name: "TimeZoneId",
                table: "Brands",
                type: "text",
                nullable: false,
                defaultValue: "America/Chicago");

            migrationBuilder.CreateTable(
                name: "SlotClaims",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Brand = table.Column<string>(type: "text", nullable: false),
                    SlotStartUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Seq = table.Column<int>(type: "integer", nullable: false),
                    HelpRequestId = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SlotClaims", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SlotClaims_Brand_SlotStartUtc_Seq",
                table: "SlotClaims",
                columns: new[] { "Brand", "SlotStartUtc", "Seq" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SlotClaims_HelpRequestId",
                table: "SlotClaims",
                column: "HelpRequestId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SlotClaims");

            migrationBuilder.DropColumn(
                name: "BusinessHoursJson",
                table: "Brands");

            migrationBuilder.DropColumn(
                name: "SlotCapacity",
                table: "Brands");

            migrationBuilder.DropColumn(
                name: "SlotMinutes",
                table: "Brands");

            migrationBuilder.DropColumn(
                name: "TimeZoneId",
                table: "Brands");
        }
    }
}
