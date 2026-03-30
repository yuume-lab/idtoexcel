import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ID_CARD_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING, description: "姓名" },
    gender: { type: Type.STRING, description: "性别 (男/女)" },
    ethnicity: { type: Type.STRING, description: "民族" },
    birthDate: { type: Type.STRING, description: "出生日期 (YYYY-MM-DD)" },
    address: { type: Type.STRING, description: "住址" },
    idNumber: { type: Type.STRING, description: "公民身份号码" },
    passportNumber: { type: Type.STRING, description: "护照号（如果有）" },
  },
  required: ["name"],
};

const app = express();
const PORT = process.env.PORT || 3000;

// Body parser for large images
app.use(express.json({ limit: '50mb' }));

// --- Gemini OCR API ---
// Moving this to server-side for security and to bypass China block if deployed outside
app.post('/api/ocr', async (req, res) => {
  const { base64Data, mimeType } = req.body;
  
  if (!base64Data) {
    return res.status(400).json({ error: "Missing image data" });
  }

  try {
    // Clean the API key to remove accidental whitespace or quotes
    // Use CUSTOM_GEMINI_API_KEY first, fallback to GEMINI_API_KEY for Vercel
    let apiKey = (process.env.CUSTOM_GEMINI_API_KEY || process.env.GEMINI_API_KEY)?.trim();
    if (apiKey && apiKey.startsWith('"') && apiKey.endsWith('"')) {
      apiKey = apiKey.slice(1, -1);
    }
    
    if (!apiKey) {
      console.error("API Key is missing in environment variables");
      return res.status(500).json({ error: "API Key is not configured on the server." });
    }

    const ai = new GoogleGenAI({ 
      apiKey: apiKey
    });
    
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-preview",
      contents: [
        {
          parts: [
            { text: "请识别这张证件（如中国身份证、护照等）正面的所有信息，并以 JSON 格式输出。如果信息不清晰，请尽力识别。" },
            { inlineData: { data: base64Data, mimeType: mimeType || 'image/jpeg' } }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: ID_CARD_SCHEMA,
      }
    });

    const result = JSON.parse(response.text || '{}');
    res.json(result);
  } catch (err: any) {
    console.error("Gemini OCR Error:", err);
    
    // Check if it's an API Key error
    if (err.message && err.message.includes('API_KEY_INVALID')) {
      return res.status(400).json({ 
        error: "API Key 无效。请检查 Vercel 环境变量中的 GEMINI_API_KEY 是否正确，并确保重新部署了项目。" 
      });
    }
    
    // Check if it's a Quota Exceeded error (429)
    if (err.status === 429 || (err.message && err.message.includes('429'))) {
      let retryAfter = 60; // Default to 60 seconds
      try {
        // Try to extract retry delay from the error message if it's JSON
        const errorBody = JSON.parse(err.message.substring(err.message.indexOf('{')));
        if (errorBody.details) {
          const retryInfo = errorBody.details.find((d: any) => d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo');
          if (retryInfo && retryInfo.retryDelay) {
            // retryDelay is usually a string like "37s" or "37.393399832s"
            retryAfter = parseFloat(retryInfo.retryDelay) || 60;
          }
        }
      } catch (e) {
        // Fallback if parsing fails
      }

      console.log(`Quota exceeded. Suggested retry after: ${retryAfter}s`);
      return res.status(429).json({
        error: `API 频率限制。请等待约 ${Math.ceil(retryAfter)} 秒后重试。`,
        retryAfter: Math.ceil(retryAfter)
      });
    }
    
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// For local development and standard Node.js deployment
if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  async function startServer() {
    // Vite middleware for development
    if (process.env.NODE_ENV !== "production") {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), 'dist');
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
  startServer();
}

// Export for Vercel Serverless Functions
export default app;
