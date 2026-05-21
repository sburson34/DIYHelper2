using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DIYHelper2.Api.Migrations
{
    /// <inheritdoc />
    public partial class ChangeDataDeletionUserIdToText : Migration
    {
        // Postgres doesn't implicitly cast uuid <-> text, so the EF-generated
        // AlterColumn produces a `TYPE text` ALTER that fails on populated
        // tables. Replace with raw SQL that includes the explicit USING cast.

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "ALTER TABLE \"DataDeletionRequests\" ALTER COLUMN \"UserId\" TYPE text USING \"UserId\"::text;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "ALTER TABLE \"DataDeletionRequests\" ALTER COLUMN \"UserId\" TYPE uuid USING \"UserId\"::uuid;");
        }
    }
}
