using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace DIYHelper2.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddBrandsAndHelpRequestBrand : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Brand",
                table: "HelpRequests",
                type: "text",
                nullable: false,
                defaultValue: "diyhelper");

            migrationBuilder.CreateTable(
                name: "Brands",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Slug = table.Column<string>(type: "text", nullable: false),
                    CompanyName = table.Column<string>(type: "text", nullable: false),
                    LeadEmail = table.Column<string>(type: "text", nullable: false),
                    LeadWebhookUrl = table.Column<string>(type: "text", nullable: true),
                    DashboardUsername = table.Column<string>(type: "text", nullable: true),
                    DashboardPasswordHash = table.Column<string>(type: "text", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Brands", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_HelpRequests_Brand",
                table: "HelpRequests",
                column: "Brand");

            migrationBuilder.CreateIndex(
                name: "IX_Brands_DashboardUsername",
                table: "Brands",
                column: "DashboardUsername",
                unique: true,
                filter: "\"DashboardUsername\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Brands_Slug",
                table: "Brands",
                column: "Slug",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Brands");

            migrationBuilder.DropIndex(
                name: "IX_HelpRequests_Brand",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "Brand",
                table: "HelpRequests");
        }
    }
}
