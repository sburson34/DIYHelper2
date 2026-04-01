import { API_BASE_URL } from '../config/api';

const BASE_URL = API_BASE_URL;

const analyzeProject = async (description, mediaItems = []) => {
  console.log(`Start analyzeProject with description: ${description} and media: ${mediaItems.length} items`);
  const url = `${BASE_URL}/api/analyze`;
  console.log(`Sending analysis request to: ${url}`);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description,
        media: mediaItems,
      }),
    });

    console.log(`Response status: ${response.status}`);

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Analysis error response:', errorData);
      throw new Error(errorData.error || 'Failed to analyze project');
    }

    return await response.json();
  } catch (error) {
    console.error('Error in analyzeProject detail:', error);
    if (error.message === 'Network request failed') {
      throw new Error(`Network error! Hit ${url} and it failed. Check adb reverse tcp:5206 tcp:5206 and that backend is running.`);
    }
    throw error;
  }
};

const askHelper = async (question, project) => {
  console.log(`Asking helper: ${question}`);
  const url = `${BASE_URL}/api/ask-helper`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        question,
        projectContext: project,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to get answer from helper');
    }

    return await response.json();
  } catch (error) {
    console.error('Error in askHelper:', error);
    throw error;
  }
};

export { analyzeProject, askHelper };
