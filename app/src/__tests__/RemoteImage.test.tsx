import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Image, TouchableOpacity } from 'react-native';
import RemoteImage from '../components/RemoteImage';
import { API_BASE_URL } from '../config/api';

const findImage = (root: renderer.ReactTestRenderer) => root.root.findByType(Image);

describe('RemoteImage', () => {
  test('prefers base64 over uri (offline capture + legacy dual-read)', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<RemoteImage base64="QUJD" uri="/api/tech/jobs/1/media/before" />);
    });
    const img = findImage(tree);
    expect(img.props.source.uri).toBe('data:image/jpeg;base64,QUJD');
  });

  test('resolves API-relative uri against API_BASE_URL and forwards headers', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <RemoteImage uri="/api/tech/jobs/1/media/before" headers={{ Authorization: 'Bearer tok' }} />,
      );
    });
    const img = findImage(tree);
    expect(img.props.source.uri).toBe(`${API_BASE_URL}/api/tech/jobs/1/media/before`);
    expect(img.props.source.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  test('leaves absolute uris untouched', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<RemoteImage uri="https://cdn.example.com/x.jpg" />);
    });
    expect(findImage(tree).props.source.uri).toBe('https://cdn.example.com/x.jpg');
  });

  test('error → tap-to-retry → re-requests with cache-busting param', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<RemoteImage uri="/api/my/requests/2/media/image" />);
    });
    act(() => { findImage(tree).props.onError(); });

    // Image is gone, retry affordance shown.
    expect(tree.root.findAllByType(Image)).toHaveLength(0);
    act(() => { tree.root.findByType(TouchableOpacity).props.onPress(); });

    const img = findImage(tree);
    expect(img.props.source.uri).toBe(`${API_BASE_URL}/api/my/requests/2/media/image?retry=1`);
  });

  test('renders placeholder when neither base64 nor uri present', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<RemoteImage testID="ph" />);
    });
    expect(tree.root.findAllByType(Image)).toHaveLength(0);
    expect(tree.root.findByProps({ testID: 'ph' })).toBeTruthy();
  });
});
