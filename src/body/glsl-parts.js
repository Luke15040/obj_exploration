/**
 * GLSL shared by the dots and block shaders: the real components as
 * recognisable 3D models (see parts.js for sizes and placement), plus the
 * provisional structure that ties them together (a frame bar and the neck).
 *
 * Every model is built in its part's local frame, centred on its bounding box,
 * and returns vec2(distance, albedo). Albedo is a grey level per material,
 * multiplied into the flat tone bands when shading.
 *
 * Sizes (mm) from the makers: STS3215 45.23×24.73×35 (Feetech drawing) ·
 * ESP32-S3 Feather 52.3×22.7×7.2 · Pi Zero 2 W 65×30, holes 58×23 · ReSpeaker
 * 2-Mics HAT 65×30×15 · Seeed enclosed speaker 50×45×22 · encoder breakout
 * 25.4² + Bourns PEC11R (12.5×13.4×6.5, M7×7, Ø6×20) · IS31FL3741 matrix
 * 51.3×39×4.6, 13×9 LEDs 2 mm at 3 mm pitch · Waveshare Bus Servo Adapter (A)
 * 42×33, holes 37×28 · USB-C PD trigger 28×11. Component heights not given by
 * the makers, and small parts (connectors, chips), are close approximations.
 *
 * The wheels and knob caps are NOT in the library: they are modelled here only
 * as shapes for the provisional body (drawn as points), not as real parts.
 */
export const partsGLSL = /* glsl */ `
#define MAX_PARTS 12
uniform int   uPartCount;
uniform int   uPartType[MAX_PARTS]; // 0 servo · 1 feather · 2 pi zero · 3 respeaker · 4 speaker · 5 encoder
                                    // 6 LED matrix · 7 servo bus adapter · 8 USB-C PD trigger
uniform float uPartEnv[MAX_PARTS];  // the envelope box is pushed back this far along local z (flush faces)
uniform vec3  uPartC[MAX_PARTS];    // bounding-box centres
uniform vec3  uPartH[MAX_PARTS];    // bounding-box half sizes, local frame
uniform mat3  uPartR[MAX_PARTS];    // local axes in world space (columns; may mirror)
uniform vec3  uChassisA;            // frame bar between the servos
uniform vec3  uChassisB;
uniform float uChassisR;
#define MAX_PRIMS 6
uniform int   uPrimCount;                // case 2 primitive skin: 0 = the free skin
uniform int   uPrimKind[MAX_PRIMS];      // 1 box · 2 circle · 3 regular polygon · 4 dome
uniform vec2  uPrimC[MAX_PRIMS];         // profile centre (xy)
uniform vec2  uPrimH[MAX_PRIMS];         // box half size · dome: (_, base below centre)
uniform float uPrimA[MAX_PRIMS];         // radius / polygon inradius
uniform int   uPrimN[MAX_PRIMS];         // polygon sides
uniform float uPrimRot[MAX_PRIMS];       // angle of the first side's normal
uniform vec2  uPrimZ[MAX_PRIMS];         // front, back z
uniform float uPrimRound[MAX_PRIMS];
uniform vec3  uNeckA;               // neck up to the screen (radius 0 = none)
uniform vec3  uNeckB;
uniform float uNeckR;
uniform int   uZero;                // always 0: keeps normal loops rolled (much faster to compile)
uniform int   uHi;                  // highlighted part (hovered in the components list), -1 = none
uniform uint  uLed[4];              // LED matrix: 117 bits, row by row from the top (the screen node draws them)

// cables: per cable 16 texels in a float texture — [0] bbox min + radius, [1] bbox max + colour code,
// [2..9] the 8 points of the routed curve
uniform sampler2D uCables;
uniform int   uCableN;
uniform vec3  uCableLo;             // bounds of all cables together (quick rejection)
uniform vec3  uCableHi;

// materials: ids into MAT_COLOR (real colours, used by the dots view's solid parts)
const float M_PLASTIC   = 0.0;   // servo case
const float M_PCB_BLACK = 1.0;   // Adafruit boards
const float M_PCB_GREEN = 2.0;   // Raspberry Pi, Seeed, Pololu
const float M_PCB_BLUE  = 3.0;   // Waveshare
const float M_BLACK     = 4.0;   // chips, headers, plastic housings
const float M_METAL     = 5.0;   // USB shells, shields, spline, encoder
const float M_WHITE     = 6.0;   // JST / Grove / STEMMA housings
const float M_RUBBER    = 7.0;
const float M_RIM       = 8.0;   // grille, light metal
const float M_LED_OFF   = 9.0;
const float M_LED_LIT   = 10.0;
const float M_BATT      = 11.0;  // LiPo shrink wrap
const float M_LABEL     = 12.0;  // LiPo label
const float M_GOLD      = 13.0;  // plated pads
const vec3 MAT_COLOR[14] = vec3[14](
  vec3(0.30, 0.30, 0.33),  // plastic (dark grey)
  vec3(0.22, 0.22, 0.24),  // pcb black (lifted so it reads on light grey)
  vec3(0.16, 0.50, 0.30),  // pcb green
  vec3(0.18, 0.36, 0.70),  // pcb blue
  vec3(0.18, 0.18, 0.19),  // black
  vec3(0.78, 0.79, 0.80),  // metal
  vec3(0.93, 0.91, 0.86),  // white plastic
  vec3(0.24, 0.24, 0.24),  // rubber
  vec3(0.55, 0.56, 0.58),  // light metal
  vec3(0.85, 0.85, 0.82),  // LED, off
  vec3(1.00, 0.55, 0.85),  // LED, lit (magenta-ish RGB)
  vec3(0.28, 0.28, 0.30),  // battery wrap
  vec3(0.95, 0.55, 0.12),  // battery label
  vec3(0.83, 0.68, 0.30)   // gold
);
vec3 matColor(float m) { return MAT_COLOR[int(clamp(m, 0.0, 13.0) + 0.5)]; }

float pBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}
float pRBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}
float pCylX(vec3 p, float r, float h) { vec2 d = vec2(length(p.yz) - r, abs(p.x) - h); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }
float pCylY(vec3 p, float r, float h) { vec2 d = vec2(length(p.xz) - r, abs(p.y) - h); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }
float pCylZ(vec3 p, float r, float h) { vec2 d = vec2(length(p.xy) - r, abs(p.z) - h); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }
vec2 pU(vec2 a, vec2 b) { return a.x < b.x ? a : b; }

/** A PCB in the xz plane: rounded rectangle, 4 mounting holes. */
float pcbSlab(vec3 q, vec2 hs, float y, float t, float r, vec2 holeAt, float holeR) {
  float d2 = length(max(abs(q.xz) - (hs - r), 0.0)) - r;
  float d = max(d2, abs(q.y - y) - t);
  if (holeR > 0.0) d = max(d, -(length(abs(q.xz) - holeAt) - holeR));
  return d;
}

/** Index along a row of n pins at 2.54 mm pitch, centred: local offset to the nearest pin. */
float pinRow(float x, float n) {
  return x - (clamp(floor(x / 2.54 + n * 0.5), 0.0, n - 1.0) - (n - 1.0) * 0.5) * 2.54;
}

// ---- FEETECH STS3215 servo (Feetech drawing) · local x = output shaft (out), y = width, z = length ----
// 45.23 × 24.73 footprint. Rear block 35 tall; the block around the shaft is 29 tall with the
// 25T spline 3.4 above and the rear hub 4.1 below (36.5 overall). Shaft 12.5 from the centre.
vec2 servoModel(vec3 q) {
  vec2 r = vec2(pRBox(q - vec3(0.0, 0.0, -7.95), vec3(17.5, 12.36, 14.67), 1.6), M_PLASTIC);   // rear block, z -22.6..6.7
  r = pU(r, vec2(pRBox(q - vec3(0.35, 0.0, 14.66), vec3(14.5, 12.36, 7.95), 1.6), M_PLASTIC)); // shaft block, z 6.7..22.6
  r.x = max(r.x, -pBox(q - vec3(10.5, 0.0, 0.0), vec3(0.3, 13.0, 23.0)));                      // cover seam
  vec3 s = q - vec3(0.0, 0.0, 12.5);                                                            // shaft axis
  r = pU(r, vec2(pCylX(s - vec3(15.0, 0.0, 0.0), 6.0, 0.15), M_PLASTIC));                      // boss ring
  r = pU(r, vec2(pCylX(s - vec3(16.55, 0.0, 0.0), 2.95, 1.7), M_METAL));                       // 25T spline, OD 5.9
  r = pU(r, vec2(pCylX(s + vec3(16.2, 0.0, 0.0), 3.0, 2.05), M_PLASTIC));                      // rear hub, 4.1
  // two 5264 3-pin sockets on the underside of the rear block
  r.x = max(r.x, -pBox(vec3(q.x + 17.5, abs(q.y) - 4.6, q.z + 0.5), vec3(1.2, 2.9, 3.9)));
  r = pU(r, vec2(pBox(vec3(q.x + 16.8, abs(q.y) - 4.6, q.z + 0.5), vec3(0.5, 2.4, 3.4)), M_BLACK));
  return r;
}

// ---- Adafruit ESP32-S3 Feather · local x = length, y = up, z = width ----
vec2 featherModel(vec3 q) {
  float pcbY = -3.6 + 0.8;
  float top = pcbY + 0.8;
  vec2 r = vec2(pcbSlab(q, vec2(26.15, 11.35), pcbY, 0.8, 2.5, vec2(23.6, 8.9), 1.25), M_PCB_BLACK);
  r = pU(r, vec2(pBox(q - vec3(12.0, top + 1.2, 0.0), vec3(9.0, 1.2, 7.7)), M_METAL));      // ESP32-S3 module can
  r = pU(r, vec2(pBox(q - vec3(22.5, top + 0.4, 0.0), vec3(1.6, 0.4, 7.7)), M_BLACK));      // antenna end
  r = pU(r, vec2(pRBox(q - vec3(-25.0, top + 1.6, 0.0), vec3(3.7, 1.6, 4.5), 1.2), M_METAL)); // USB-C
  r = pU(r, vec2(pBox(q - vec3(-17.5, top + 2.9, -6.6), vec3(3.0, 2.9, 3.9)), M_WHITE));    // JST battery
  r = pU(r, vec2(pBox(q - vec3(-9.5, top + 1.5, 8.6), vec3(3.0, 1.5, 2.1)), M_WHITE));      // STEMMA QT
  r = pU(r, vec2(pBox(q - vec3(-14.5, top + 0.9, 6.0), vec3(1.6, 0.9, 1.3)), M_BLACK));     // reset / boot
  r = pU(r, vec2(pBox(q - vec3(-14.5, top + 0.9, 2.2), vec3(1.6, 0.9, 1.3)), M_BLACK));
  r = pU(r, vec2(pBox(q - vec3(-4.0, top + 0.5, -7.0), vec3(1.25, 0.5, 1.25)), M_WHITE));   // NeoPixel
  float pads = pCylY(vec3(pinRow(q.x, 16.0), q.y - top, abs(q.z) - 10.08), 0.85, 0.08);     // header pads
  r = pU(r, vec2(pads, M_GOLD));
  return r;
}

// ---- Raspberry Pi Zero 2 W with pre-soldered header · local x = length, y = up, z = width ----
vec2 piZeroModel(vec3 q) {
  float pcbY = -5.0 + 0.7;
  float top = pcbY + 0.7;
  vec2 r = vec2(pcbSlab(q, vec2(32.5, 15.0), pcbY, 0.7, 3.0, vec2(29.0, 11.5), 1.375), M_PCB_GREEN);
  r = pU(r, vec2(pBox(q - vec3(0.0, top + 1.25, 11.5), vec3(25.4, 1.25, 2.54)), M_BLACK));   // header base
  float pin = pBox(vec3(pinRow(q.x, 20.0), q.y - (top + 5.5), abs(q.z - 11.5) - 1.27), vec3(0.32, 3.0, 0.32));
  r = pU(r, vec2(pin, M_METAL));                                                             // 40 pins
  r = pU(r, vec2(pBox(q - vec3(-1.5, top + 0.6, -1.5), vec3(6.5, 0.6, 6.5)), M_METAL));      // RP3A0 can
  r = pU(r, vec2(pRBox(q - vec3(-20.1, top + 1.6, -11.8), vec3(5.6, 1.6, 3.8), 0.6), M_METAL)); // mini HDMI
  r = pU(r, vec2(pRBox(q - vec3(8.9, top + 1.3, -12.9), vec3(3.9, 1.3, 2.9), 0.6), M_METAL));   // micro USB
  r = pU(r, vec2(pRBox(q - vec3(21.5, top + 1.3, -12.9), vec3(3.9, 1.3, 2.9), 0.6), M_METAL));
  r = pU(r, vec2(pBox(q - vec3(-26.0, top + 0.7, 0.0), vec3(6.0, 0.7, 7.0)), M_METAL));      // microSD
  r = pU(r, vec2(pBox(q - vec3(31.0, top + 0.6, 0.0), vec3(1.8, 0.6, 8.5)), M_BLACK));       // CSI
  return r;
}

// ---- ReSpeaker 2-Mics Pi HAT (sits on the Pi header) · same frame as the Pi ----
vec2 respeakerModel(vec3 q) {
  vec2 r = vec2(pBox(q - vec3(0.0, -7.5 + 4.25, 11.5), vec3(25.4, 4.25, 2.54)), M_BLACK);   // female header
  float pcbY = -7.5 + 8.5 + 0.8;
  float top = pcbY + 0.8;
  r = pU(r, vec2(pcbSlab(q, vec2(32.5, 15.0), pcbY, 0.8, 3.0, vec2(29.0, 11.5), 1.375), M_PCB_GREEN));
  r = pU(r, vec2(pCylY(vec3(abs(q.x) - 28.5, q.y - (top + 0.5), q.z + 11.0), 1.6, 0.5), M_METAL)); // 2 mics
  r = pU(r, vec2(pBox(q - vec3(0.0, top + 1.2, -11.5), vec3(3.0, 1.2, 3.0)), M_BLACK));     // button
  r = pU(r, vec2(pCylY(q - vec3(0.0, top + 2.8, -11.5), 1.7, 0.45), M_BLACK));
  r = pU(r, vec2(pBox(vec3(abs(q.x - 0.0) < 4.0 ? q.x : abs(q.x) - 8.0, q.y - (top + 0.7), q.z + 3.5), vec3(2.5, 0.7, 2.5)), M_WHITE)); // 3 LEDs
  r = pU(r, vec2(pBox(q - vec3(25.5, top + 2.5, 1.0), vec3(3.0, 2.5, 6.0)), M_BLACK));      // 3.5 mm jack
  r = pU(r, vec2(pBox(q - vec3(13.5, top + 1.8, 9.0), vec3(3.0, 1.8, 2.2)), M_WHITE));      // JST speaker out
  r = pU(r, vec2(pBox(q - vec3(-20.0, top + 2.5, 5.5), vec3(5.0, 2.5, 4.0)), M_WHITE));     // Grove × 2
  r = pU(r, vec2(pBox(q - vec3(-7.5, top + 2.5, 5.5), vec3(5.0, 2.5, 4.0)), M_WHITE));
  return r;
}

// ---- Seeed mono enclosed speaker · local z = facing out ----
vec2 speakerModel(vec3 q) {
  vec2 r = vec2(pRBox(q, vec3(25.0, 22.5, 11.0), 3.0), M_BLACK);
  r.x = max(r.x, -max(length(q.xy) - 19.0, abs(q.z - 11.0) - 0.9));           // grille recess
  float grille = pCylZ(q - vec3(0.0, 0.0, 10.2), 19.0, 0.2);
  vec2 g = mod(q.xy + 1.2, 2.4) - 1.2;
  grille = max(grille, -(length(g) - 0.7));                                   // perforation
  r = pU(r, vec2(grille, M_RIM));
  r = pU(r, vec2(pCylZ(q - vec3(0.0, -16.0, -11.6), 1.6, 1.0), M_BLACK));     // cable exit
  return r;
}

// ---- Adafruit I2C rotary encoder breakout + Bourns PEC11R · local z = shaft (toward the knob) ----
// Board 25.4 × 25.4 × 1.6. PEC11R body 12.5 × 13.4 × 6.5, M7 bushing 7 long, Ø6 shaft 20 from the
// mounting surface with a 10 mm flat.
vec2 encoderModel(vec3 q) {
  vec2 r = vec2(pcbSlab(q.xzy, vec2(12.7, 12.7), -6.75, 0.8, 1.5, vec2(10.2, 10.2), 1.25), M_PCB_BLACK);
  float c = 0.70710678;
  vec3 k = vec3(c * (q.x + q.y), c * (q.y - q.x), q.z);                                 // PEC11 sits at 45°
  r = pU(r, vec2(pBox(k - vec3(0.0, 0.0, -2.7), vec3(6.25, 6.7, 3.25)), M_METAL));        // body, z -5.95..0.55
  r = pU(r, vec2(pCylZ(q - vec3(0.0, 0.0, 4.05), 3.5, 3.5), M_METAL));                    // M7 bushing
  float shaft = pCylZ(q - vec3(0.0, 0.0, 14.05), 3.0, 6.5);                               // to 20 above the body
  shaft = max(shaft, q.x - 1.5 - step(q.z, 10.55) * 100.0);                               // D flat, last 10 mm
  r = pU(r, vec2(shaft, M_METAL));
  r = pU(r, vec2(pBox(vec3(abs(q.x) - 10.6, q.y, q.z + 4.45), vec3(2.1, 3.0, 1.5)), M_WHITE)); // STEMMA QT × 2
  r = pU(r, vec2(pBox(q - vec3(0.0, -9.5, -5.45), vec3(1.25, 1.25, 0.5)), M_WHITE));          // NeoPixel
  return r;
}

// ---- Adafruit IS31FL3741 13×9 RGB LED matrix · local z = facing out ----
// 51.3 × 39.0 × 4.6. 117 LEDs, 2 × 2 mm at 3 mm pitch. STEMMA QT × 2 on the back.
float litLED(vec2 cell) {
  // what the screen node drew (starts as a quiet face)
  int i = int(cell.y) * 13 + int(cell.x);
  return float((uLed[i >> 5] >> uint(i & 31)) & 1u);
}
// ---- Adafruit Monochrome 1.3" 128×64 OLED (938) · local x = width, y = up, z = screen out ----
// PCB 35.6 × 33 (mounting holes 30.5 × 28, Ø2.5), glass panel 34.5 × 23 × 1.45 set 3 mm low,
// active area 29.42 × 14.7 with a few lit white pixels, 8 header holes along the top, STEMMA QT × 2 behind.
vec2 oledModel(vec3 q) {
  vec2 r = vec2(pcbSlab(q.xzy, vec2(17.8, 16.5), 0.6, 0.8, 1.5, vec2(15.25, 14.0), 1.25), M_PCB_BLACK);
  vec3 g = q - vec3(0.0, -3.0, 2.1);
  r = pU(r, vec2(pBox(g, vec3(17.25, 11.5, 0.72)), M_BLACK));                          // glass panel
  // lit pixels: two eyes and a smile, drawn in the active area
  vec2 a = g.xy;
  float eyes = pBox(vec3(abs(a.x) - 6.0, a.y - 2.5, g.z - 0.75), vec3(1.6, 2.2, 0.05));
  float smile = max(abs(length(a - vec2(0.0, 3.0)) - 7.5) - 0.7, a.y + 1.5);   // lower arc only
  smile = max(smile, abs(g.z - 0.75) - 0.05);
  r = pU(r, vec2(min(eyes, smile), M_WHITE));
  r = pU(r, vec2(pBox(vec3(pinRow(q.x, 8.0), q.y - 14.6, q.z - 1.45), vec3(0.5, 0.5, 0.06)), M_GOLD)); // header holes
  r = pU(r, vec2(pBox(vec3(abs(q.x) - 14.0, q.y + 10.0, q.z + 1.3), vec3(3.0, 2.1, 1.2)), M_WHITE)); // STEMMA QT × 2
  return r;
}

vec2 matrixModel(vec3 q) {
  vec2 r = vec2(pcbSlab(q.xzy, vec2(25.65, 19.5), 0.9, 0.8, 1.5, vec2(23.15, 17.0), 1.25), M_BLACK);
  vec2 cell = clamp(floor((q.xy + vec2(19.5, 13.5)) / 3.0), vec2(0.0), vec2(12.0, 8.0));
  vec2 c = q.xy - (cell * 3.0 - vec2(18.0, 12.0));
  float led = pBox(vec3(c, q.z - 2.0), vec3(1.0, 1.0, 0.3));
  float lit = litLED(vec2(cell.x, 8.0 - cell.y));
  r = pU(r, vec2(led, lit > 0.5 ? M_LED_LIT : M_LED_OFF));
  r = pU(r, vec2(pBox(vec3(abs(q.x) - 19.0, q.y + 14.0, q.z + 1.1), vec3(3.0, 2.1, 1.2)), M_WHITE)); // STEMMA QT × 2
  return r;
}

// ---- Waveshare Bus Servo Adapter (A) · local x = length, y = up, z = width ----
// Board 42 × 33, mounting holes 37 × 28 (Ø2.5). USB-C, 5.5×2.1 DC jack + screw terminal, servo bus ports.
vec2 adapterModel(vec3 q) {
  float pcbY = -6.0 + 0.8;
  float top = pcbY + 0.8;
  vec2 r = vec2(pcbSlab(q, vec2(21.0, 16.5), pcbY, 0.8, 1.5, vec2(18.5, 14.0), 1.25), M_PCB_BLUE);
  r = pU(r, vec2(pBox(q - vec3(-16.0, top + 5.5, -8.0), vec3(7.0, 5.5, 4.5)), M_BLACK));     // DC barrel jack
  r = pU(r, vec2(pCylX(q - vec3(-22.4, top + 5.0, -8.0), 3.2, 0.6), M_BLACK));
  r = pU(r, vec2(pBox(q - vec3(-17.0, top + 5.0, 7.0), vec3(3.8, 5.0, 4.0)), M_WHITE));      // screw terminal
  r = pU(r, vec2(pRBox(q - vec3(19.5, top + 1.6, 0.0), vec3(3.7, 1.6, 4.5), 1.2), M_METAL));  // USB-C
  r = pU(r, vec2(pBox(vec3(q.x - 4.0, q.y - (top + 3.0), abs(q.z) - 10.5), vec3(3.9, 3.0, 2.5)), M_WHITE)); // servo ports
  r = pU(r, vec2(pBox(q - vec3(4.0, top + 0.9, 0.0), vec3(3.0, 0.9, 3.0)), M_BLACK));        // USB-UART chip
  float pin = pBox(vec3(pinRow(q.z, 4.0), q.y - (top + 4.0), q.x - 12.0), vec3(0.32, 4.0, 0.32));
  r = pU(r, vec2(pin, M_METAL));                                                             // UART header
  return r;
}

// ---- USB-C PD trigger module · local x = length, y = up, z = width ----
// 28 × 11 board: USB-C input, DIP switch (5/9/12/15/20 V), output pads.
vec2 pdModel(vec3 q) {
  float pcbY = -2.25 + 0.6;
  float top = pcbY + 0.6;
  vec2 r = vec2(pcbSlab(q, vec2(14.0, 5.5), pcbY, 0.6, 0.8, vec2(0.0), 0.0), M_PCB_BLACK);
  r = pU(r, vec2(pRBox(q - vec3(-10.5, top + 1.6, 0.0), vec3(3.65, 1.6, 4.47), 1.2), M_METAL)); // USB-C
  r = pU(r, vec2(pBox(q - vec3(2.0, top + 1.0, 0.0), vec3(4.0, 1.0, 3.0)), M_BLACK));          // DIP switch
  r = pU(r, vec2(pBox(vec3(q.x - 2.0 - (clamp(floor((q.x - 2.0) / 2.54 + 1.5), 0.0, 2.0) - 1.0) * 2.54, q.y - (top + 2.2), q.z), vec3(0.6, 0.2, 1.0)), M_WHITE)); // switch levers
  r = pU(r, vec2(pBox(vec3(q.x - 11.5, q.y - (top + 0.1), abs(q.z) - 2.5), vec3(1.5, 0.1, 1.5)), M_METAL)); // output pads
  return r;
}

// ---- 3S LiPo pack (Tattu 850 mAh, 60 × 30 × 23) · local x = length, y = up, z = width ----
vec2 batteryModel(vec3 q) {
  vec2 r = vec2(pRBox(q, vec3(30.0, 11.5, 15.0), 3.0), M_BATT);                      // shrink-wrapped pack
  r = pU(r, vec2(pRBox(q - vec3(4.0, 0.0, 0.0), vec3(18.0, 11.7, 15.2), 2.5), M_LABEL)); // label band
  r = pU(r, vec2(pBox(vec3(q.x + 30.5, q.y - 5.0, abs(q.z) - 7.0), vec3(1.0, 2.5, 3.0)), M_BLACK)); // lead exits
  return r;
}

// ---- Pololu D36V28F5 5 V step-down (17.8 × 20.3 × 8.8) · local x = width, y = up, z = length ----
vec2 buckModel(vec3 q) {
  float pcbY = -4.4 + 0.8;
  float top = pcbY + 0.8;
  vec2 r = vec2(pcbSlab(q, vec2(8.9, 10.15), pcbY, 0.8, 0.8, vec2(6.5, 7.8), 1.1), M_PCB_GREEN);
  r = pU(r, vec2(pRBox(q - vec3(1.5, top + 2.6, 2.5), vec3(4.0, 2.6, 4.0), 0.8), M_BLACK)); // inductor
  r = pU(r, vec2(pBox(q - vec3(-4.5, top + 0.5, 2.0), vec3(1.5, 0.5, 2.0)), M_BLACK));      // controller
  float pin = pBox(vec3(pinRow(q.x, 6.0), q.y - (pcbY - 2.5), q.z + 8.9), vec3(0.32, 2.5, 0.32));
  r = pU(r, vec2(pin, M_METAL));                                                            // 6-pin header
  return r;
}

/** Detailed model of part i at world point p: vec2(distance, albedo). */
vec2 partModel(int i, vec3 p) {
  vec3 q = transpose(uPartR[i]) * (p - uPartC[i]); // world → local
  int t = uPartType[i];
  // cheap bounding test first (the encoder shaft sticks out along +z)
  vec3 ext = t == 5 ? vec3(0.0, 0.0, 6.5) : vec3(0.0);
  float bnd = pBox(q - ext, uPartH[i] + ext + 2.0);
  if (bnd > 0.5) return vec2(bnd, M_PLASTIC);
  if (t == 0) return servoModel(q);
  if (t == 1) return featherModel(q);
  if (t == 2) return piZeroModel(q);
  if (t == 3) return respeakerModel(q);
  if (t == 4) return speakerModel(q);
  if (t == 5) return encoderModel(q);
  if (t == 6) return matrixModel(q);
  if (t == 7) return adapterModel(q);
  if (t == 8) return pdModel(q);
  if (t == 9) return batteryModel(q);
  if (t == 11) return oledModel(q);
  return buckModel(q);
}

/** Bounding box of part i, pushed back by uPartEnv along local z — the envelope is grown around these. */
float partSDF(int i, vec3 p) {
  vec3 q = transpose(uPartR[i]) * (p - uPartC[i]);
  q.z += uPartEnv[i];
  return pBox(q, uPartH[i]);
}

/** Nearest cable: vec2(distance, colour code). Bounding box per cable first. */
const vec3 CABLE_COLOR[8] = vec3[8](
  vec3(0.12, 0.12, 0.12),  // 0 servo bus
  vec3(0.13, 0.13, 0.14),  // 1 STEMMA QT
  vec3(0.78, 0.13, 0.12),  // 2 3S power
  vec3(0.80, 0.18, 0.16),  // 3 5 V
  vec3(0.95, 0.76, 0.12),  // 4 UART
  vec3(0.10, 0.10, 0.10),  // 5 USB
  vec3(0.70, 0.12, 0.12),  // 6 speaker
  vec3(0.13, 0.13, 0.14)   // 7 Grove → STEMMA QT
);
vec3 cableColor(float code) { return CABLE_COLOR[int(clamp(code, 0.0, 7.0) + 0.5)]; }
vec2 cablesSDF(vec3 p) {
  vec2 best = vec2(1e9, 0.0);
  if (uCableN == 0) return best;
  float all = pBox(p - 0.5 * (uCableLo + uCableHi), 0.5 * (uCableHi - uCableLo));
  if (all > 2.0) return vec2(all, 0.0);
  for (int c = 0; c < uCableN; c++) {
    int b = c * 16;
    vec4 lo = texelFetch(uCables, ivec2(b, 0), 0);
    vec4 hi = texelFetch(uCables, ivec2(b + 1, 0), 0);
    float bb = pBox(p - 0.5 * (lo.xyz + hi.xyz), 0.5 * (hi.xyz - lo.xyz));
    if (bb > 1.0) { if (bb < best.x) best = vec2(bb, hi.w); continue; }
    vec3 a = texelFetch(uCables, ivec2(b + 2, 0), 0).xyz;
    for (int k = 1; k < 14 + uZero; k++) {
      vec3 e = texelFetch(uCables, ivec2(b + 2 + k, 0), 0).xyz;
      vec3 pa = p - a, ba = e - a;
      float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
      float d = length(pa - ba * h) - lo.w;
      if (d < best.x) best = vec2(d, hi.w);
      a = e;
    }
  }
  return best;
}

/** Cables seen where the ray misses the skin (the cable to the wall runs outside the object). */
vec4 cablesOnly(vec3 ro, vec3 rd, float t, float tEnd) {
  if (uCableN == 0) return vec4(0.0);
  for (int i = 0; i < 64; i++) {
    vec3 p = ro + rd * t;
    vec2 cb = cablesSDF(p);
    if (cb.x < 0.05) {
      vec2 e = vec2(0.3, 0.0);
      vec3 n = normalize(vec3(cablesSDF(p + e.xyy).x - cablesSDF(p - e.xyy).x,
                              cablesSDF(p + e.yxy).x - cablesSDF(p - e.yxy).x,
                              cablesSDF(p + e.yyx).x - cablesSDF(p - e.yyx).x));
      return vec4(cableColor(cb.y) * (0.6 + 0.5 * max(dot(n, normalize(uLight)), 0.0)), 1.0);
    }
    t += max(cb.x, 0.05);
    if (t > tEnd) break;
  }
  return vec4(0.0);
}

/** Nearest real part (detailed); idx = its index. */
float partsSDF(vec3 p, out int idx) {
  // bounding boxes first (cheap); the detailed model only for the one or two nearest
  float d1 = 1e9, d2 = 1e9;
  int i1 = 0, i2 = 0;
  for (int i = 0; i < uPartCount; i++) {
    vec3 q = transpose(uPartR[i]) * (p - uPartC[i]);
    vec3 ext = uPartType[i] == 5 ? vec3(0.0, 0.0, 6.5) : vec3(0.0);
    float b = pBox(q - ext, uPartH[i] + ext);
    if (b < d1) { d2 = d1; i2 = i1; d1 = b; i1 = i; }
    else if (b < d2) { d2 = b; i2 = i; }
  }
  idx = i1;
  if (d1 > 1.0) return d1;
  float e = partModel(i1, p).x;
  if (d2 < 1.0) {
    float e2 = partModel(i2, p).x;
    if (e2 < e) { e = e2; idx = i2; }
  } else {
    e = min(e, d2);
  }
  return e;
}

/**
 * Wheel Ø90 × 30, axle along local x, outer face toward +x: grooved tyre on a
 * rim with five lightening holes and a hub. vec2(distance, albedo).
 */
vec2 wheelModel(vec3 q) {
  float rr = length(q.yz);
  float bound = max(rr - 45.5, abs(q.x) - 15.5);
  if (bound > 1.0) return vec2(bound, M_RUBBER);                              // far away: skip the detail
  vec2 dt = vec2(rr - 41.0, abs(q.x) - 11.0);
  float tyre = min(max(dt.x, dt.y), 0.0) + length(max(dt, 0.0)) - 4.0;        // rounded tyre
  tyre = max(tyre, -max(abs(abs(q.x) - 5.0) - 0.8, 43.6 - rr));               // two tread grooves
  tyre = max(tyre, -max(rr - 31.0, 11.0 - abs(q.x)));                         // rim recess, both faces
  float sector = 6.2831853 / 5.0;
  float a = mod(atan(q.z, q.y) + sector * 0.5, sector) - sector * 0.5;
  vec2 h = rr * vec2(cos(a), sin(a)) - vec2(19.0, 0.0);
  tyre = max(tyre, -max(length(h) - 5.5, abs(q.x) - 12.0));                   // lightening holes
  float hub = pCylX(q - vec3(12.5, 0.0, 0.0), 8.0, 2.5);                      // hub on the outer side
  float d = min(tyre, hub);
  float albedo = hub < tyre + 0.05 ? M_METAL : (rr > 33.0 ? M_RUBBER : M_RIM);
  return vec2(d, albedo);
}

/** Both wheels; mirrored so the hub faces outward. */
vec2 wheelsModel(vec3 p, vec2 wl, vec2 wr) {
  vec3 ql = p - vec3(wl, 0.0);
  ql.x = -ql.x;
  return pU(wheelModel(ql), wheelModel(p - vec3(wr, 0.0)));
}

/** Slim rubber knob (≈ Ø14.5 × 11.5) on add-on i: ribbed grip, chamfered top. */
vec2 knobModel(int i, vec3 p, vec3 dims) {
  vec3 P = uExtraP[i], N = uExtraN[i];
  float s = uExtraInfo[i].y;
  vec3 a = abs(N.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0);
  vec3 u = normalize(cross(N, a));
  vec3 v = cross(N, u);
  vec3 rel = p - P;
  vec3 q = vec3(dot(rel, u), dot(rel, v), dot(rel, N));
  float r = dims.x * s, hh = dims.y * s * 0.5;
  float d = pCylZ(q - vec3(0.0, 0.0, hh), r, hh);
  if (d > 1.0) return vec2(d, M_RUBBER);                                      // far away: skip the ribs
  d = max(d, (length(q.xy) - r + 1.2) * 0.7071 + (q.z - 2.0 * hh) * 0.7071);  // chamfer
  float sector = 6.2831853 / 24.0;
  float ang = mod(atan(q.y, q.x) + sector * 0.5, sector) - sector * 0.5;
  d = max(d, -(length(q.xy) * abs(sin(ang)) - 0.35 + max(0.0, r - 0.6 - length(q.xy)) * 10.0)); // grip ribs
  return vec2(d, M_RUBBER);
}
`;
