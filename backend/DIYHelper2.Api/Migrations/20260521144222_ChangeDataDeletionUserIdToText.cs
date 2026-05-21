using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DIYHelper2.Api.Migrations
{
    /// <inheritdoc />
    public partial class ChangeDataDeletionUserIdToText : Migration
    {
        // The shared 0.5.2 model changes UserId from Guid? to string?. On
        // Postgres the column is `uuid` and needs ALTER ... TYPE text USING
        // ... ::text (Postgres doesn't implicitly cast uuid <-> text). On
        // SQLite both Guid and string are stored as TEXT, so no schema
        // change is needed; the provider dispatch keeps the migration safe
        // when the SQLite provider runs it (e.g. integration tests).

        private const string NpgsqlProvider = "Npgsql.EntityFrameworkCore.PostgreSQL";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            if (migrationBuilder.ActiveProvider == NpgsqlProvider)
            {
                migrationBuilder.Sql(
                    "ALTER TABLE \"DataDeletionRequests\" ALTER COLUMN \"UserId\" TYPE text USING \"UserId\"::text;");
            }
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            if (migrationBuilder.ActiveProvider == NpgsqlProvider)
            {
                migrationBuilder.Sql(
                    "ALTER TABLE \"DataDeletionRequests\" ALTER COLUMN \"UserId\" TYPE uuid USING \"UserId\"::uuid;");
            }
        }
    }
}
