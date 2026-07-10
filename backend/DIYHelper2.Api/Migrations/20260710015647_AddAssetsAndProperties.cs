using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace DIYHelper2.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddAssetsAndProperties : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "AssetId",
                table: "HelpRequests",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PropertyId",
                table: "HelpRequests",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Assets",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Brand = table.Column<string>(type: "text", nullable: false),
                    DeviceId = table.Column<string>(type: "text", nullable: true),
                    CustomerEmail = table.Column<string>(type: "text", nullable: true),
                    PropertyId = table.Column<int>(type: "integer", nullable: true),
                    Label = table.Column<string>(type: "text", nullable: false),
                    Make = table.Column<string>(type: "text", nullable: true),
                    Model = table.Column<string>(type: "text", nullable: true),
                    Serial = table.Column<string>(type: "text", nullable: true),
                    InstalledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    WarrantyExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    WarrantyReminderCreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Assets", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "CustomerProperties",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Brand = table.Column<string>(type: "text", nullable: false),
                    CustomerId = table.Column<int>(type: "integer", nullable: false),
                    Label = table.Column<string>(type: "text", nullable: false),
                    Address = table.Column<string>(type: "text", nullable: true),
                    City = table.Column<string>(type: "text", nullable: true),
                    State = table.Column<string>(type: "text", nullable: true),
                    Zip = table.Column<string>(type: "text", nullable: true),
                    Lat = table.Column<double>(type: "double precision", nullable: true),
                    Lng = table.Column<double>(type: "double precision", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CustomerProperties", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_HelpRequests_Brand_AssetId",
                table: "HelpRequests",
                columns: new[] { "Brand", "AssetId" });

            migrationBuilder.CreateIndex(
                name: "IX_Assets_Brand_CustomerEmail",
                table: "Assets",
                columns: new[] { "Brand", "CustomerEmail" });

            migrationBuilder.CreateIndex(
                name: "IX_Assets_Brand_DeviceId",
                table: "Assets",
                columns: new[] { "Brand", "DeviceId" });

            migrationBuilder.CreateIndex(
                name: "IX_CustomerProperties_Brand_CustomerId",
                table: "CustomerProperties",
                columns: new[] { "Brand", "CustomerId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Assets");

            migrationBuilder.DropTable(
                name: "CustomerProperties");

            migrationBuilder.DropIndex(
                name: "IX_HelpRequests_Brand_AssetId",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "AssetId",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "PropertyId",
                table: "HelpRequests");
        }
    }
}
