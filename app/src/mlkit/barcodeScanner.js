// ML Kit barcode scanning via react-native-vision-camera-mlkit.
// Falls back gracefully if the native module is unavailable.

import { addBreadcrumb, reportHandledError } from '../services/monitoring';

let scanBarcodes;
try {
  const mlkit = require('react-native-vision-camera-mlkit');
  scanBarcodes = mlkit.useBarcodeScanner || mlkit.scanBarcodes;
} catch {
  scanBarcodes = null;
}

export const isBarcodeScannerAvailable = () => scanBarcodes != null;

/**
 * Create a barcode frame processor callback for vision-camera.
 * Returns null if ML Kit barcode module is unavailable.
 */
export const createBarcodeProcessor = () => {
  if (!scanBarcodes) return null;
  try {
    return scanBarcodes;
  } catch (error) {
    reportHandledError('MLKit_barcode_init', error, { feature: 'barcodeScanner' });
    return null;
  }
};

/**
 * Process a barcode scan result and add monitoring breadcrumbs.
 */
export const handleBarcodeScan = (barcodes, callback) => {
  if (!barcodes || barcodes.length === 0) return;
  const first = barcodes[0];
  const data = first.rawValue || first.displayValue || first.data;
  const format = first.format || first.type || 'unknown';
  if (data) {
    addBreadcrumb('mlkit: barcode scanned', 'mlkit', { format, dataLength: data.length });
    callback({ data, format });
  }
};
