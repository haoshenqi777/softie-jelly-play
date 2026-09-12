# Mobile rendering and feeding correction

The approved mesh, pink palette, lighting setup and textures remain the visual
baseline. No mobile material substitution or WebGL fallback.

## Confirmed failures and changes

- A one-candy scene always passed a count of zero to floor placement. Use a
  separate drop counter, placing successive candies along the visible floor arc.
- A stable candy ID selects high, left or right pounce. These use different
  shoulder contact directions, anticipation durations, jump heights and finite
  crown bends. Same-ID retaps retain the current choreography. Translation is a
  single launch impulse followed by the existing gravity/contact solver.
- The last visible sugar disappears 5.25 seconds before colour settling ends.
  Satisfaction now starts at that disappearance; dye duration remains unchanged.
  Enclosure/savour movements have greater bounded amplitude; contact stages
  still add no feeding body forces, and direct input still takes precedence.

## Phone-only horizontal artifacts

Reported on iPhone 14 Pro in WeChat and other phone browsers, including original
pink. Desktop does not reproduce. Do not equate viewport resizing with iPhone
GPU validation. First isolate reflection, ray depth and interior capture with
the opt-in ?rendercheck=1 controls. Each option resets the other optical terms.
They change uniforms without a reload, preserving the same camera and shape.

An independently confirmed WGSL domain issue was corrected: signed altitude
squaring now uses multiplication instead of pow(negative, 2). This preserves the
intended curve but is not yet proof that all photographed stripes are fixed.

## Verification

Regression: same floor position, three successive candy IDs, three actual
contact anchors, all complete absorption; five floor directions; cube/round
hand insertion/release; first visible disappearance gives a non-neutral face.
No source textures or model files are changed.
