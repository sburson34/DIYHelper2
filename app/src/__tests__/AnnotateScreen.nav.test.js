// PhotoAnnotator is a heavy component with its own canvas deps; we mock it
// to a simple View that exposes the save button via a testID.
jest.mock('../components/PhotoAnnotator', () => {
  const React = require('react');
  const { View, TouchableOpacity, Text } = require('react-native');
  return function PhotoAnnotator({ onSave, onCancel }) {
    return React.createElement(View, null,
      React.createElement(TouchableOpacity, {
        testID: 'save-btn',
        onPress: () => onSave({ strokes: [], captionedUri: 'file://annotated.jpg' }),
      }, React.createElement(Text, null, 'save')),
      React.createElement(TouchableOpacity, {
        testID: 'cancel-btn',
        onPress: onCancel,
      }, React.createElement(Text, null, 'cancel')),
    );
  };
});

const AnnotateScreen = require('../screens/AnnotateScreen').default;
const { renderScreen, fireEvent } = require('./helpers/renderWithNav');

describe('AnnotateScreen', () => {
  it('onSave navigates to Capture with annotation payload', () => {
    const { navigation, getByTestId } = renderScreen(AnnotateScreen, {
      params: { photoUri: 'file://raw.jpg', mediaIndex: 2 },
    });

    fireEvent.press(getByTestId('save-btn'));

    expect(navigation.navigate).toHaveBeenCalledWith('Capture', expect.objectContaining({
      annotationResult: expect.objectContaining({
        mediaIndex: 2,
        captionedUri: 'file://annotated.jpg',
      }),
    }));
  });

  it('onCancel goes back', () => {
    const { navigation, getByTestId } = renderScreen(AnnotateScreen, {
      params: { photoUri: 'file://raw.jpg', mediaIndex: 0 },
    });

    fireEvent.press(getByTestId('cancel-btn'));

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
