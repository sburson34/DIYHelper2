using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace DIYHelper2.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSmsMessaging : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SmsFromNumber",
                table: "Brands",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "SmsMessages",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Brand = table.Column<string>(type: "text", nullable: false),
                    HelpRequestId = table.Column<int>(type: "integer", nullable: true),
                    Direction = table.Column<string>(type: "text", nullable: false),
                    FromNumber = table.Column<string>(type: "text", nullable: true),
                    ToNumber = table.Column<string>(type: "text", nullable: true),
                    Body = table.Column<string>(type: "text", nullable: false),
                    RemoteId = table.Column<string>(type: "text", nullable: true),
                    Sent = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SmsMessages", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SmsMessages_Brand_HelpRequestId",
                table: "SmsMessages",
                columns: new[] { "Brand", "HelpRequestId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SmsMessages");

            migrationBuilder.DropColumn(
                name: "SmsFromNumber",
                table: "Brands");
        }
    }
}
