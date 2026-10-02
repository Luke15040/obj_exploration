# object viz

Prototype visualisation for an AI tool that builds small physical devices from a
short prompt. The object is made only of real parts from a component library
(servos, ESP32 / Raspberry Pi, speaker, rotary encoders, LED matrix, battery and
regulator), laid out with clearance and real cables; everything else (the shell,
wheels, knob caps) is provisional and drawn as the "body".

- **case 1 · robot** — two wheels and an LED-matrix face; prompts: frog, wall-e, speak
- **case 2 · speaker** — a speaker box; free skin or primitive shapes (box, cylinder,
  prism, hexagon, pentagon, octagon, dome) or a random **totem**, with the speaker
  and knobs placing themselves on the faces
- **views** — pixel 3d (opens first, front view), dots, flat 1, flat 2, dither 1, dither 2, glass, empty

Vanilla JS + WebGL2 (raymarched SDFs), no build step.

## Run locally

```
python serve.py
```

then open http://127.0.0.1:5179/ (any static server works).
