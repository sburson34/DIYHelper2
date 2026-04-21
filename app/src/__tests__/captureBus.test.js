// captureBus is a tiny pub/sub used by the drawer to ask the Capture screen
// to reset. The contract: all subscribers run per publish, and one subscriber
// throwing must not stop the others — otherwise the drawer could "brick" the
// reset signal across navigations.

const { subscribeReset, requestCaptureReset } = require('../utils/captureBus');

describe('captureBus', () => {
  it('invokes every subscriber on publish', () => {
    const a = jest.fn();
    const b = jest.fn();
    subscribeReset(a);
    subscribeReset(b);
    requestCaptureReset();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops future deliveries', () => {
    const fn = jest.fn();
    const off = subscribeReset(fn);
    requestCaptureReset();
    off();
    requestCaptureReset();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('isolates subscriber errors — one throw does not block others', () => {
    const first = jest.fn(() => { throw new Error('boom'); });
    const second = jest.fn();
    subscribeReset(first);
    subscribeReset(second);
    expect(() => requestCaptureReset()).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
