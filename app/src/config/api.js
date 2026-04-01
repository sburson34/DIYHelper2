// For local development on phone, use your computer's IP or localhost if using adb reverse.
// Run setup-phone-proxy.ps1 to forward localhost:5206 on your phone to your PC.
export const API_BASE_URL =
  __DEV__ ? "http://192.168.15.240:5206" : "https://api.diyhelper.org";
