using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DIYHelper2.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddQuoteOptions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "QuoteOptionsJson",
                table: "HelpRequests",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "QuoteSelectedOption",
                table: "HelpRequests",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "QuoteOptionsJson",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "QuoteSelectedOption",
                table: "HelpRequests");
        }
    }
}
