import { API_BASE_URL } from "../config/api";

export async function postRequest(
  endpoint,
  data
) {
  const response = await fetch(
    `${API_BASE_URL}/api/${endpoint}`,
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
        "x-api-key": "YOUR_SECRET_KEY"
      },
      body: JSON.stringify(data)
    }
  );

  if (!response.ok) {
    throw new Error(
      `API error ${response.status}`
    );
  }

  return await response.json();
}
