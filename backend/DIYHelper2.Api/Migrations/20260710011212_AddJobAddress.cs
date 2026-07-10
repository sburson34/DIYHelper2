using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DIYHelper2.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddJobAddress : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Address",
                table: "HelpRequests",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "City",
                table: "HelpRequests",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "Lat",
                table: "HelpRequests",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "Lng",
                table: "HelpRequests",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "State",
                table: "HelpRequests",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Zip",
                table: "HelpRequests",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Address",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "City",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "Lat",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "Lng",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "State",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "Zip",
                table: "HelpRequests");
        }
    }
}
