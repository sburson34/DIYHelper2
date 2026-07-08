using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DIYHelper2.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddHelpRequestCrmRemoteId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CrmRemoteId",
                table: "HelpRequests",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CrmRemoteId",
                table: "HelpRequests");
        }
    }
}
