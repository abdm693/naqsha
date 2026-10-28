# Spikes (2026-10-16)

## Concept images: Vertex AI, `global` location, prompt = modern 10 marla DHA Lahore house, golden hour

| Model | Time | File |
|---|---|---|
| `gemini-3.1-flash-image` | ~11 s | concept-flash-image.jpg |
| `gemini-nano-banana-2.1` | ~20 s | concept-nano-banana.jpg |
| `gemini-3-pro-image` | ~53 s | concept-pro-image.jpg |

All three render 1376–1408 × 768 photoreal results with convincing local context. Use flash-image for concept rounds and pro-image for hero shots.

## Argon writing raw three.js in one shot (`argon-oneshot-threejs.html`)

- **Input:** `gemini-4-argon`, streaming, given the flash-image concept as reference plus a detailed brief.
- **Time:** 481 s in total; the first token arrived after 164 s.
- **Output:** 37.7k tokens, 1,780 lines.
- **What worked:** it ran first time with no console errors. It built a coherent exterior matching the concept (timber canopy, stone tower, glass balcony, gate, porch), plus interiors, stairs with railings, furniture, floor toggles and view presets.
- **What fell short:** the look is blocky and low-fidelity (flat colours, primitive furniture, blob trees), and it is too slow for an interactive loop.
- **Decision:** Argon writes *short, sectioned* code against our own House SDK. The SDK holds the PBR materials, HDRI, AO, furniture kit and the structure-from-plan builder, so output is faster, higher fidelity, editable section by section, and tagged for compliance and comments.

To view the spike, serve this folder and open the file:

```bash
python3 -m http.server -d docs/spikes 8765
```
