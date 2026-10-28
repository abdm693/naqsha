"""Narration lines -> vo/<id>.wav with Gemini TTS on Vertex AI (the Naqsha Nebius GCP project). Skips lines already made."""
import json, sys, wave
from pathlib import Path
from google import genai
from google.genai import types

HERE = Path(__file__).parent
STYLE = ("Read this as the narrator of a short product film: calm, warm and confident, a light Pakistani English accent, "
         "at a natural conversational pace of about 160 words a minute, clear consonants, short pauses at commas only: ")
# Spoken forms for names the voice gets wrong; the film's text keeps the real spelling.
SAY = {"Naqsha": "Nuksha", "Nemotron": "Nemo-tron", "Tavily": "Tavilee", "NVIDIA": "N-vidia", "CDA's": "C D A's"}


def spoken(text: str) -> str:
    for k, v in SAY.items():
        text = text.replace(k, v)
    return text
c = genai.Client(vertexai=True, project="naqsha-nebius-424e", location="global")
only = set(sys.argv[1:])
for line in json.loads((HERE / "vo_lines.json").read_text()):
    out = HERE / "vo" / f"{line['id']}.wav"
    if (out.exists() and not only) or (only and line["id"] not in only):
        continue
    r = c.models.generate_content(model="gemini-2.5-pro-tts", contents=STYLE + spoken(line["text"]), config=types.GenerateContentConfig(
        response_modalities=["AUDIO"], speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Charon")))))
    pcm = r.candidates[0].content.parts[0].inline_data.data
    with wave.open(str(out), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(pcm)
    print(line["id"], round(len(pcm) / 48000, 2), "s", flush=True)
