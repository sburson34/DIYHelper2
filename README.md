# DIYHelper2

A full native phone app for DIY project assistance.

## Project Structure

- `app/`: React Native mobile application.
- `backend/`: C# ASP.NET Core API using OpenAI for analysis.

## Features

- Take pictures and videos of your DIY project.
- Record or type descriptions.
- AI-powered step-by-step list generation.
- Full native experience.

## Getting Started

### Backend

1. Navigate to `backend/DIYHelper2.Api`.
2. Set your `OPENAI_API_KEY` environment variable.
3. Run `dotnet run`.
4. The API will be available at `http://localhost:5206`.

### App

1. Navigate to `app/`.
2. Run `npm install`.
3. Update `src/api/backendClient.js` with your backend URL.
4. Run `npx react-native start`.
5. Run `npx react-native run-android` or `run-ios`.

## Dependencies

- React Native 0.83.0
- Expo SDK 55
- React Navigation
- React Native Image Picker
- React Native Vision Camera
- Expo Audio
- Expo Mail Composer
- ASP.NET Core 10.0
- OpenAI SDK for .NET
