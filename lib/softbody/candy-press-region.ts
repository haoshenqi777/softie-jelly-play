// User-marked patch between the eyes and forehead, in the approved model's
// rest coordinates. Mapping the hit back to rest keeps it attached to the face.
export function allowsHandCandyPress(point: {
  x: number;
  y: number;
  z: number;
}) {
  const x = point.x / 0.5;
  const y = (point.y - 1.08) / 0.48;
  return point.z < 0.8 || x * x + y * y > 1;
}
