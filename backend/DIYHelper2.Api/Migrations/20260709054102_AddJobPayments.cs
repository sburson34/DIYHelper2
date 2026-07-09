using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DIYHelper2.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddJobPayments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "AmountPaid",
                table: "HelpRequests",
                type: "numeric(12,2)",
                precision: 12,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "PaidAt",
                table: "HelpRequests",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AmountPaid",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "PaidAt",
                table: "HelpRequests");
        }
    }
}
