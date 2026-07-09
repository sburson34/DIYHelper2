// Smoke test for the telemetry shim — verifies it wires the shared factory to
// DIYHelper2's backend (posts batched events to /api/telemetry/events). The
// buffering/flush logic itself is covered in @sburson34/mobile-shared.
import { initTelemetry, track, flushTelemetry } from '../services/telemetry';

describe('telemetry shim', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => ({ ok: true }));
  });

  it('flushes tracked events to /api/telemetry/events', async () => {
    await initTelemetry();
    track('app_opened');
    track('screen_viewed', { screen: 'NewProject' });
    await flushTelemetry();

    expect(global.fetch).toHaveBeenCalled();
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/api/telemetry/events');
    const body = JSON.parse(opts.body);
    const names = body.events.map((e) => e.name);
    expect(names).toContain('app_opened');
    expect(names).toContain('screen_viewed');
    expect(body.events.find((e) => e.name === 'screen_viewed').props).toEqual({ screen: 'NewProject' });
  });

  it('tags each batch with the active brand via the X-Brand header', async () => {
    // Per-brand MAU billing keys off X-Brand; without it the backend can't
    // attribute active installs to a white-label tenant. Defaults to the
    // flagship 'diyhelper' brand when no brand build config is present (Jest).
    await initTelemetry();
    track('app_opened');
    await flushTelemetry();

    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers['X-Brand']).toBe('diyhelper');
  });
});
