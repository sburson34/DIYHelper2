using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace DIYHelper2.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCustomerAndBookingFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DeviceId",
                table: "HelpRequests",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "PreferredDate",
                table: "HelpRequests",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PreferredWindow",
                table: "HelpRequests",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ScheduledFor",
                table: "HelpRequests",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ServiceType",
                table: "HelpRequests",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "TechEtaMinutes",
                table: "HelpRequests",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FeaturesJson",
                table: "Brands",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "MembershipEnabled",
                table: "Brands",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "Phone",
                table: "Brands",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReviewUrl",
                table: "Brands",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ServiceTypesJson",
                table: "Brands",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Customers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Brand = table.Column<string>(type: "text", nullable: false),
                    DeviceId = table.Column<string>(type: "text", nullable: true),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Email = table.Column<string>(type: "text", nullable: true),
                    Phone = table.Column<string>(type: "text", nullable: true),
                    EmailVerified = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastSeenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Customers", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_HelpRequests_Brand_DeviceId",
                table: "HelpRequests",
                columns: new[] { "Brand", "DeviceId" });

            migrationBuilder.CreateIndex(
                name: "IX_Customers_Brand_DeviceId",
                table: "Customers",
                columns: new[] { "Brand", "DeviceId" });

            migrationBuilder.CreateIndex(
                name: "IX_Customers_Brand_Email",
                table: "Customers",
                columns: new[] { "Brand", "Email" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Customers");

            migrationBuilder.DropIndex(
                name: "IX_HelpRequests_Brand_DeviceId",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "DeviceId",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "PreferredDate",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "PreferredWindow",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "ScheduledFor",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "ServiceType",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "TechEtaMinutes",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "FeaturesJson",
                table: "Brands");

            migrationBuilder.DropColumn(
                name: "MembershipEnabled",
                table: "Brands");

            migrationBuilder.DropColumn(
                name: "Phone",
                table: "Brands");

            migrationBuilder.DropColumn(
                name: "ReviewUrl",
                table: "Brands");

            migrationBuilder.DropColumn(
                name: "ServiceTypesJson",
                table: "Brands");
        }
    }
}
