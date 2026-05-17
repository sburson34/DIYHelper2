# syntax=docker/dockerfile:1.7

FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src

# nuget.config (at repo root) points dotnet restore at the GHCR feed for
# Sburson.Shared.Backend. The package is public, so no credentials are
# needed here.
COPY nuget.config nuget.config
COPY backend/DIYHelper2.slnx backend/
COPY backend/DIYHelper2.Api/DIYHelper2.Api.csproj backend/DIYHelper2.Api/
COPY backend/DIYHelper2.Tests/DIYHelper2.Tests.csproj backend/DIYHelper2.Tests/
RUN dotnet restore backend/DIYHelper2.Api/DIYHelper2.Api.csproj

COPY backend/ backend/
WORKDIR /src/backend/DIYHelper2.Api
RUN dotnet publish -c Release -o /app/publish --no-restore /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache wget icu-libs
ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=false
COPY --from=build --chown=app:app /app/publish .
USER app
EXPOSE 8080
ENTRYPOINT ["dotnet", "DIYHelper2.Api.dll"]
