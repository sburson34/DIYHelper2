// PanResponder-based drawing canvas overlay for photo annotation.
// Tracks strokes as arrays of {x, y, t} points for ML Kit digital ink.

import React, { useRef, useState, useCallback } from 'react';
import { View, PanResponder, StyleSheet } from 'react-native';
let Svg, Path;
try { ({ default: Svg, Path } = require('react-native-svg')); } catch {}

// Fallback for missing react-native-svg: just render the container
const hasSvg = (() => {
  try { require('react-native-svg'); return true; } catch { return false; }
})();

export default function DrawingCanvas({ width, height, strokeColor = '#FF3B30', strokeWidth = 3, onStrokesChange }) {
  const [strokes, setStrokes] = useState([]);
  const currentStroke = useRef([]);

  const addPoint = useCallback((x, y) => {
    currentStroke.current.push({ x, y, t: Date.now() });
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        currentStroke.current = [{ x: locationX, y: locationY, t: Date.now() }];
      },
      onPanResponderMove: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        addPoint(locationX, locationY);
        // Force re-render to show in-progress stroke
        setStrokes(prev => [...prev]); // triggers re-render
      },
      onPanResponderRelease: () => {
        if (currentStroke.current.length > 1) {
          const newStrokes = [...strokes, { points: [...currentStroke.current] }];
          setStrokes(newStrokes);
          onStrokesChange?.(newStrokes);
        }
        currentStroke.current = [];
      },
    })
  ).current;

  const pointsToSvgPath = (points) => {
    if (!points || points.length === 0) return '';
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x} ${points[i].y}`;
    }
    return d;
  };

  const undo = useCallback(() => {
    setStrokes(prev => {
      const next = prev.slice(0, -1);
      onStrokesChange?.(next);
      return next;
    });
  }, [onStrokesChange]);

  const clear = useCallback(() => {
    setStrokes([]);
    onStrokesChange?.([]);
  }, [onStrokesChange]);

  return (
    <View
      style={[styles.container, { width, height }]}
      {...panResponder.panHandlers}
    >
      {hasSvg ? (
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          {strokes.map((stroke, i) => (
            <Path
              key={i}
              d={pointsToSvgPath(stroke.points)}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {currentStroke.current.length > 1 && (
            <Path
              d={pointsToSvgPath(currentStroke.current)}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.7}
            />
          )}
        </Svg>
      ) : (
        // Fallback: draw colored dots at touch points (no SVG)
        strokes.map((stroke, i) =>
          stroke.points.map((p, j) => (
            <View
              key={`${i}-${j}`}
              style={[styles.dot, {
                left: p.x - strokeWidth,
                top: p.y - strokeWidth,
                width: strokeWidth * 2,
                height: strokeWidth * 2,
                backgroundColor: strokeColor,
              }]}
            />
          ))
        )
      )}
    </View>
  );

  // Expose imperative methods
  DrawingCanvas.undo = undo;
  DrawingCanvas.clear = clear;
}

// Static methods for external control
DrawingCanvas.undo = () => {};
DrawingCanvas.clear = () => {};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  dot: {
    position: 'absolute',
    borderRadius: 999,
  },
});
