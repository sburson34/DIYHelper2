using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace DIYHelper2.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddQuickBooksAccounting : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "InvoiceRemoteId",
                table: "HelpRequests",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "BrandAccountingConnections",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    BrandSlug = table.Column<string>(type: "text", nullable: false),
                    Provider = table.Column<int>(type: "integer", nullable: false),
                    RealmId = table.Column<string>(type: "text", nullable: true),
                    AccessTokenEnc = table.Column<string>(type: "text", nullable: true),
                    RefreshTokenEnc = table.Column<string>(type: "text", nullable: true),
                    AccessTokenExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BrandAccountingConnections", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BrandAccountingConnections_BrandSlug",
                table: "BrandAccountingConnections",
                column: "BrandSlug",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BrandAccountingConnections");

            migrationBuilder.DropColumn(
                name: "InvoiceRemoteId",
                table: "HelpRequests");
        }
    }
}
