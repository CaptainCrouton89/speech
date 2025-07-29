import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";
import type Replicate from "replicate";
import { z } from "zod";

export function registerAudioToTextTool(
  server: McpServer,
  replicate: Replicate
) {
  server.tool(
    "audio-to-text",
    "Transcribe audio files to text with word-level timestamps using WhisperX. Automatically saves transcript with timestamps, sentence-level timestamps, and returns directory reference.",
    {
      audio_file: z.string().describe("Path to the audio file to transcribe"),
      language: z
        .string()
        .optional()
        .default("en")
        .describe(
          "ISO code of the language spoken in the audio, specify None to perform language detection"
        ),
      language_detection_min_prob: z
        .number()
        .optional()
        .describe(
          "If language is not specified, then the language will be detected recursively on different parts of the file until it reaches the given probability"
        ),
      language_detection_max_tries: z
        .number()
        .int()
        .optional()
        .describe(
          "If language is not specified, then the language will be detected following the logic of language_detection_min_prob parameter, but will stop after the given max retries"
        ),
      initial_prompt: z
        .string()
        .optional()
        .describe("Optional text to provide as a prompt for the first window"),
      batch_size: z
        .number()
        .int()
        .optional()
        .describe("Parallelization of input audio transcription"),
      temperature: z
        .number()
        .optional()
        .describe("Temperature to use for sampling"),
      vad_onset: z.number().optional().describe("VAD onset"),
      vad_offset: z.number().optional().describe("VAD offset"),
      align_output: z
        .boolean()
        .optional()
        .describe(
          "Aligns whisper output to get accurate word-level timestamps"
        ),
      diarization: z.boolean().optional().describe("Assign speaker ID labels"),
      huggingface_access_token: z
        .string()
        .optional()
        .describe(
          "To enable diarization, please enter your HuggingFace token (read). You need to accept the user agreement for the models specified in the README"
        ),
      min_speakers: z
        .number()
        .int()
        .optional()
        .describe(
          "Minimum number of speakers if diarization is activated (leave blank if unknown)"
        ),
      max_speakers: z
        .number()
        .int()
        .optional()
        .describe(
          "Maximum number of speakers if diarization is activated (leave blank if unknown)"
        ),
      debug: z
        .boolean()
        .optional()
        .describe(
          "Print out compute/inference times and memory usage information"
        ),
      filename: z
        .string()
        .optional()
        .describe(
          "Optional filename for the transcript file (without extension). Defaults to timestamp"
        ),
    },
    async ({
      audio_file,
      language = "en",
      language_detection_min_prob,
      language_detection_max_tries,
      initial_prompt,
      batch_size = 64,
      temperature = 0,
      vad_onset = 0.5,
      vad_offset = 0.363,
      align_output = true,
      diarization = true,
      huggingface_access_token,
      min_speakers,
      max_speakers,
      debug = false,
      filename,
    }) => {
      try {
        // Initialize Supabase client
        const supabaseUrl = "https://yiwkbafldsqjvrktrlbu.supabase.co";
        const supabaseKey =
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlpd2tiYWZsZHNxanZya3RybGJ1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MjM2Mzk1MiwiZXhwIjoyMDU3OTM5OTUyfQ.CkuQ95MQ-FPWNNR1BVxCA13MsihRvubo_spZYy2zHZc";

        const supabase = createClient(supabaseUrl, supabaseKey);

        // Create bucket if it doesn't exist
        const { data: buckets, error: bucketsError } =
          await supabase.storage.listBuckets();

        if (bucketsError) {
          console.error("Error listing buckets:", bucketsError);
          throw new Error(`Failed to list buckets: ${bucketsError.message}`);
        }

        const audioBucketExists = buckets?.some(
          (bucket) => bucket.name === "audio"
        );

        if (!audioBucketExists) {
          const { error: createBucketError } =
            await supabase.storage.createBucket("audio", {
              public: true,
            });
          if (createBucketError) {
            console.error("Error creating bucket:", createBucketError);
            throw new Error(
              `Failed to create audio bucket: ${createBucketError.message}`
            );
          }
        } else {
        }

        // Upload file to Supabase storage
        const fileBuffer = readFileSync(audio_file);

        const fileName = `${Date.now()}-${basename(audio_file)}`;
        const filePath = `audio/${fileName}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("audio")
          .upload(filePath, fileBuffer, {
            contentType: "audio/wav",
            upsert: false,
          });

        if (uploadError) {
          console.error("Upload error:", uploadError);
          throw new Error(
            `Failed to upload file to Supabase: ${uploadError.message}`
          );
        }

        // Get public URL
        const { data: urlData } = supabase.storage
          .from("audio")
          .getPublicUrl(filePath);

        const publicUrl = urlData.publicUrl;

        const input: any = {
          audio_file: publicUrl,
        };

        if (language) input.language = language;
        if (initial_prompt) input.initial_prompt = initial_prompt;
        if (language_detection_min_prob) input.language_detection_min_prob = language_detection_min_prob;
        if (language_detection_max_tries) input.language_detection_max_tries = language_detection_max_tries;
        if (temperature !== undefined) input.temperature = temperature;
        if (batch_size !== undefined) input.batch_size = batch_size;
        if (vad_onset !== undefined) input.vad_onset = vad_onset;
        if (vad_offset !== undefined) input.vad_offset = vad_offset;
        if (align_output !== undefined) input.align_output = align_output;
        if (diarization !== undefined) input.diarization = diarization;
        if (debug !== undefined) input.debug = debug;
        if (huggingface_access_token) input.huggingface_access_token = huggingface_access_token;
        if (min_speakers !== undefined) input.min_speakers = min_speakers;
        if (max_speakers !== undefined) input.max_speakers = max_speakers;

        const output = (await replicate.run(
          "victor-upmeet/whisperx:84d2ad2d6194fe98a17d2b60bef1c7f910c46b2f6fd38996ca457afd9c8abfcb",
          {
            input,
          }
        )) as {
          detected_language?: string;
          segments?: Array<{
            start: number;
            end: number;
            text: string;
          }>;
        };

        console.log("Replicate output:", JSON.stringify(output, null, 2));

        if (!output) {
          throw new Error("No output received from Replicate API");
        }

        const audioDir = join(process.cwd(), "audio");
        mkdirSync(audioDir, { recursive: true });

        const baseFilename =
          filename || new Date().toISOString().replace(/[:.]/g, "-");
        const transcriptPath = join(
          audioDir,
          `${baseFilename}_transcript.json`
        );
        const textPath = join(audioDir, `${baseFilename}_transcript.txt`);
        const sentencesPath = join(audioDir, `${baseFilename}_sentences.json`);

        const transcriptData = {
          detected_language: output.detected_language || "unknown",
          segments: output.segments || [],
          metadata: {
            transcribed_at: new Date().toISOString(),
            audio_file: audio_file,
            model: "victor-upmeet/whisperx",
            settings: {
              language,
              temperature,
              diarization,
              align_output,
            },
          },
        };

        writeFileSync(transcriptPath, JSON.stringify(transcriptData, null, 2));

        let textContent = `Audio Transcript\n`;
        textContent += `Transcribed: ${new Date().toISOString()}\n`;
        textContent += `Detected Language: ${output.detected_language || 'unknown'}\n\n`;

        if (output.segments && output.segments.length > 0) {
          output.segments.forEach((segment) => {
            const startTime = new Date(segment.start * 1000)
              .toISOString()
              .substring(11, 23);
            const endTime = new Date(segment.end * 1000)
              .toISOString()
              .substring(11, 23);
            textContent += `[${startTime} - ${endTime}]: ${segment.text.trim()}\n\n`;
          });
        }

        writeFileSync(textPath, textContent);

        // Generate sentence-level timestamps by grouping segments
        const sentenceTimestamps = [];
        if (output.segments && output.segments.length > 0) {
          let currentSentence = "";
          let sentenceStart = output.segments[0].start;

          for (let i = 0; i < output.segments.length; i++) {
            const segment = output.segments[i];
            currentSentence += segment.text;

            // Check if this segment ends a sentence (contains sentence-ending punctuation)
            const endsWithPunctuation = /[.!?][\s]*$/.test(segment.text.trim());
            const isLastSegment = i === output.segments.length - 1;

            if (endsWithPunctuation || isLastSegment) {
              sentenceTimestamps.push({
                sentence: currentSentence.trim(),
                start_time: sentenceStart,
                end_time: segment.end,
                duration: segment.end - sentenceStart,
              });

              // Reset for next sentence
              if (i < output.segments.length - 1) {
                currentSentence = "";
                sentenceStart = output.segments[i + 1].start;
              }
            }
          }
        }

        const sentenceData = {
          sentence_timestamps: sentenceTimestamps,
          metadata: {
            transcribed_at: new Date().toISOString(),
            audio_file: audio_file,
            model: "victor-upmeet/whisperx",
            detected_language: output.detected_language,
            settings: {
              language,
              temperature,
              diarization,
              align_output,
            },
          },
        };

        writeFileSync(sentencesPath, JSON.stringify(sentenceData, null, 2));

        const segmentCount = output.segments?.length || 0;
        const duration =
          output.segments && output.segments.length > 0
            ? output.segments[output.segments.length - 1].end
            : 0;

        return {
          content: [
            {
              type: "text",
              text: `Audio transcription completed successfully!

Segments: ${segmentCount}
Sentences: ${sentenceTimestamps.length}
Duration: ${duration.toFixed(2)} seconds

Files saved:
- Full transcript with timestamps: ${transcriptPath}
- Human-readable transcript: ${textPath}
- Sentence-level timestamps: ${sentencesPath}

Audio directory: ${audioDir}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error transcribing audio: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    }
  );
}
