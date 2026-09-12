type Device = Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>;

/** Roll out to the Apple mobile family confirmed by device A/B.
 * A narrow viewport or a touchscreen alone is not evidence of this GPU issue. */
export function prefersLinearGelCapture(device: Device) {
  return (
    /iPhone|iPad|iPod/.test(device.userAgent) ||
    (device.platform === 'MacIntel' && device.maxTouchPoints > 1)
  );
}
