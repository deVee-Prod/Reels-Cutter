import { NextRequest, NextResponse } from 'next/server';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';

const execAsync = promisify(exec);
const FFMPEG_PATH = process.env.VERCEL ? 'ffmpeg' : (process.env.FFMPEG_PATH ?? '/opt/homebrew/bin/ffmpeg');
const TMP_DIR = process.env.VERCEL ? '/tmp' : join(process.cwd(), 'tmp');

export async function POST(req: NextRequest) {
  // בדיקת cookie
  const cookie = req.cookies.get('session_access');
  if (cookie?.value !== 'granted') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!existsSync(TMP_DIR)) await mkdir(TMP_DIR, { recursive: true });

  const id = randomUUID();
  const formData = await req.formData();
  const videoFile = formData.get('video') as File;
  if (!videoFile) return NextResponse.json({ error: 'Missing video' }, { status: 400 });

  const ext = videoFile.name.split('.').pop()?.toLowerCase() ?? 'mov';
  const inputPath = join(TMP_DIR, `input_${id}.${ext}`);
  const audioPath = join(TMP_DIR, `audio_${id}.mp3`);

  await writeFile(inputPath, Buffer.from(await videoFile.arrayBuffer()));

  try {
    // חילוץ אודיו ל-mp3 קטן
    await execAsync(`"${FFMPEG_PATH}" -y -i "${inputPath}" -vn -ar 16000 -ac 1 -b:a 64k "${audioPath}"`);

    const audioBuffer = await import('fs/promises').then(fs => fs.readFile(audioPath));
    const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });

    const whisperForm = new FormData();
    whisperForm.append('file', blob, 'audio.mp3');
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

    // בניית מערך שתיקות מתוך מילים של Whisper
    const words: { start: number; end: number }[] = whisperData.words ?? [];
    const duration: number = whisperData.duration ?? 0;

    const silences: { start: number; end: number | null }[] = [];
    const SILENCE_THRESHOLD = 0.4; // שתיקה מינימלית בשניות

    let lastEnd = 0;
    for (const word of words) {
      const gap = word.start - lastEnd;
      if (gap >= SILENCE_THRESHOLD) {
        // יש שתיקה — הסגמנט הוא מ-lastEnd עד word.start
        silences.push({ start: lastEnd, end: word.start });
      }
      lastEnd = word.end;
    }
    // סגמנט אחרון עד סוף הוידאו
    silences.push({ start: lastEnd, end: null });

    // segments = החלקים שרוצים לשמור (לא השתיקות)
    const segments: { start: number; end: number | null }[] = [];
    let segStart = 0;
    for (const word of words) {
      const gap = word.start - segStart;
      if (gap >= SILENCE_THRESHOLD) {
        if (segStart < word.start) segments.push({ start: segStart, end: word.start - 0.001 });
        segStart = word.start;
      }
      segStart = word.end;
    }
    segments.push({ start: segStart, end: null });

    // בניית segments נכון: החלקים שמדברים
    const speechSegments = buildSpeechSegments(words, duration, SILENCE_THRESHOLD);

    return NextResponse.json({ segments: speechSegments });

  } finally {
    await Promise.allSettled([unlink(inputPath), unlink(audioPath)]);
  }
}

function buildSpeechSegments(
  words: { start: number; end: number }[],
  duration: number,
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