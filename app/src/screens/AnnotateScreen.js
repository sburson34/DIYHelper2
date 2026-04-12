// Stack screen for photo annotation.
// Receives a photo via route params, returns annotated data on save.

import React from 'react';
import PhotoAnnotator from '../components/PhotoAnnotator';

export default function AnnotateScreen({ navigation, route }) {
  const { photoUri, mediaIndex } = route.params || {};

  const handleSave = (annotationData) => {
    navigation.navigate('Capture', {
      annotationResult: {
        mediaIndex,
        ...annotationData,
      },
    });
  };

  const handleCancel = () => {
    navigation.goBack();
  };

  return (
    <PhotoAnnotator
      photoUri={photoUri}
      onSave={handleSave}
      onCancel={handleCancel}
    />
  );
}
