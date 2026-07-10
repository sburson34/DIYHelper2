using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DIYHelper2.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddJobMediaKeys : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AfterPhotoKey",
                table: "HelpRequests",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BeforePhotoKey",
                table: "HelpRequests",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ImageKey",
                table: "HelpRequests",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SignatureKey",
                table: "HelpRequests",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AfterPhotoKey",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "BeforePhotoKey",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "ImageKey",
                table: "HelpRequests");

            migrationBuilder.DropColumn(
                name: "SignatureKey",
                table: "HelpRequests");
        }
    }
}
