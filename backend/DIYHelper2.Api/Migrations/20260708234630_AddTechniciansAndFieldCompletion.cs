using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace DIYHelper2.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddTechniciansAndFieldCompletion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AfterPhotoBase64",
                table: "HelpRequests",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "AssignedTechId",
                table: "HelpRequests",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BeforePhotoBase64",
                table: "HelpRequests",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CompletedAt",
                table: "HelpRequests",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CompletionNotes",
                table: "HelpRequests",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SignatureBase64",
                table: "HelpRequests",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Technicians",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Brand = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Phone = table.Column<string>(type: "text", nullable: true),
                    Email = table.Column<string>(type: "text", nullable: true),
                    LoginCodeHash = table.Column<string>(type: "text", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Technicians", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_HelpRequests_Brand_AssignedTechId",
                table: "HelpRequests",
                columns: new[] { "Brand", "AssignedTechId" });

            migrationBuilder.CreateIndex(
                name: "IX_Technicians_Brand_Active",
                table: "Technicians",
                columns: new[] { "Brand", "IsActive" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Technicians");

            migrationBuilder.DropIndex(
                name: "IX_HelpRequests_Brand_AssignedTechId",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "AfterPhotoBase64",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "AssignedTechId",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "BeforePhotoBase64",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "CompletedAt",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "CompletionNotes",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "SignatureBase64",
                table: "HelpRequests");
        }
    }
}
