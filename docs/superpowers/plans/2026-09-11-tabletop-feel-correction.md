# Restore expressive tabletop interaction

User correction: keep the smaller space but restore soft deformation, useful lift, head compression and full feeding jumps. Single finger starting on empty space rotates 360 degrees; two fingers zoom only. Body/candy gestures must keep ownership until released.

Root cause: the previous tabletop input scaled every displacement by .72 then saturated downward travel at .5 and lift at .7; extra COM damping acted throughout the neutral zone and feeding height was multiplied by .42. None were optical material changes.

1. Regressions: normal-range grip targets and head compression match free mode; release limits only excessive whole-body travel; repeated grabs remain bounded at a larger useful lift height.
2. Restore local target response and feeding/turn hops. Move containment force to the edge of the small area, and lift ceiling beyond ordinary deformation. Preserve material/damping settings.
3. Route single background touch to orbit with stable ownership; promote any two-touch gesture to zoom only, suppress its remaining finger until all release. Keep direct body/candy interaction separate.
4. Check actual WASM feeding/contact, lifecycle, UI, build, independent review and publish the same authorized site.
