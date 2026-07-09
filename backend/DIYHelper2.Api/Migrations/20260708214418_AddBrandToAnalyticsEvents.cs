using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DIYHelper2.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddBrandToAnalyticsEvents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Brand",
                table: "AnalyticsEvents",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_AnalyticsEvents_Brand_OccurredAt_AnonId",
                table: "AnalyticsEvents",
                columns: new[] { "Brand", "OccurredAt", "AnonId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_AnalyticsEvents_Brand_OccurredAt_AnonId",
                table: "AnalyticsEvents");

            migrationBuilder.DropColumn(
                name: "Brand",
                table: "AnalyticsEvents");
        }
    }
}
