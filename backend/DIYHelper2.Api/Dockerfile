# syntax=docker/dockerfile:1.7

FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src

# nuget.config (at repo root) authenticates the GHCR feed via
# %GITHUB_USERNAME% / %GITHUB_TOKEN%. Pass the token in via BuildKit secret;
# the username can be a build arg (defaults to "sburson34" — the org).
ARG GITHUB_USERNAME=sburson34
COPY nuget.config nuget.config
COPY backend/DIYHelper2.slnx backend/
COPY backend/DIYHelper2.Api/DIYHelper2.Api.csproj backend/DIYHelper2.Api/
COPY backend/DIYHelper2.Tests/DIYHelper2.Tests.csproj backend/DIYHelper2.Tests/
RUN --mount=type=secret,id=github_token,env=GITHUB_TOKEN \
    dotnet restore backend/DIYHelper2.Api/DIYHelper2.Api.csproj

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
