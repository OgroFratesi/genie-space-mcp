import OAuth from "oauth-1.0a";
import crypto from "crypto";
import axios, { AxiosError } from "axios";
import FormData from "form-data";

const X_API_KEY = process.env.X_API_KEY!;
const X_API_SECRET = process.env.X_API_SECRET!;
const X_ACCESS_TOKEN = process.env.X_ACCESS_TOKEN!;
const X_ACCESS_SECRET = process.env.X_ACCESS_SECRET!;

const TWEET_URL = "https://api.twitter.com/2/tweets";
const MEDIA_UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";

const oauth = new OAuth({
  consumer: { key: X_API_KEY, secret: X_API_SECRET },
  signature_method: "HMAC-SHA1",
  hash_function(baseString, key) {
    return crypto.createHmac("sha1", key).update(baseString).digest("base64");
  },
});

const token = { key: X_ACCESS_TOKEN, secret: X_ACCESS_SECRET };

function authHeader(method: string, url: string): string {
  return oauth.toHeader(oauth.authorize({ url, method }, token)).Authorization;
}

async function uploadMedia(imageUrl: string): Promise<string> {
  // Download image bytes from URL (e.g. Cloudinary)
  const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
  const imageBuffer = Buffer.from(imageResponse.data);
  const mimeType = (imageResponse.headers["content-type"] as string) || "image/jpeg";

  const form = new FormData();
  form.append("media", imageBuffer, { contentType: mimeType, filename: "image" });

  const response = await axios.post(MEDIA_UPLOAD_URL, form, {
    headers: {
      Authorization: authHeader("POST", MEDIA_UPLOAD_URL),
      ...form.getHeaders(),
    },
  });

  return response.data.media_id_string as string;
}

export async function postTweet(text: string, imageUrl?: string): Promise<string> {
  try {
    let mediaId: string | undefined;
    if (imageUrl) {
      mediaId = await uploadMedia(imageUrl);
    }

    const payload: Record<string, unknown> = { text };
    if (mediaId) {
      payload.media = { media_ids: [mediaId] };
    }

    const response = await axios.post(TWEET_URL, payload, {
      headers: {
        Authorization: authHeader("POST", TWEET_URL),
        "Content-Type": "application/json",
      },
    });

    const tweetId: string = response.data.data.id;
    return `https://x.com/i/web/status/${tweetId}`;
  } catch (err) {
    const axiosErr = err as AxiosError;
    if (axiosErr.response) {
      const status = axiosErr.response.status;
      const data = axiosErr.response.data as any;
      const detail = data?.detail ?? data?.errors?.[0]?.message ?? axiosErr.message;
      throw new Error(`X API error (${status}): ${detail}`);
    }
    throw err;
  }
}
