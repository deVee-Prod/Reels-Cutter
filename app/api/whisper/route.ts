import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  // בדיקת cookie
  const cookie = req.cookies.get('session_access');
  if (cookie?.value !== 'granted') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await req.formData();
  const audioFile = formData.get('video') as File;
  if (!audioFile) return NextResponse.json({ error: 'Missing audio' }, { status: 400 });

  try {
    // שולחים ישירות ל-Whisper — ה-mp3 כבר מוכן מהלקוח
    const whisperForm = new FormData();
    whisperForm.append('file', audioFile, 'audio.mp3');
    whisperForm.append('model', 'whisper-1');
    whisperForm.append('response_format', 'verbose_json');
    whisperForm.append('timestamp_granularities[]', 'word');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: whisperForm,
    });

    if (!whisperRes.ok) {
      const err = await whisperRes.text();
      throw new Error(`Whisper error: ${err}`);
    }

    const whisperData = await whisperRes.json();
    const words: { start: number; end: number }[] = whisperData.words ?? [];

    const segments = buildSpeechSegments(words, 0.4);
    return NextResponse.json({ segments });

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

function buildSpeechSegments(
  words: { start: number; end: number }[],
  threshold: number
): { start: number; end: number | null }[] {
  if (words.length === 0) return [{ start: 0, end: null }];

  const segments: { start: number; end: number | null }[] = [];
  let segStart = words[0].start;
  let segEnd = words[0].end;

  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - segEnd;
    if (gap >= threshold) {
      segments.push({ start: segStart, end: segEnd });
      segStart = words[i].start;
    }
    segEnd = words[i].end;
  }
  segments.push({ start: segStart, end: null });

  return segments;
}

export const maxDuration = 60;